#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
charger_bdd_grist.py — charge un gros fichier académique (Excel .xlsx ou CSV) dans Grist, par l'API.

Pourquoi : l'import de Grist (« Ajouter → Importer depuis un fichier ») refuse les très gros fichiers.
L'API accepte des paquets de lignes : le programme lit le fichier petit à petit et l'envoie par paquets.

Le programme tourne sur VOTRE ordinateur. Les données ne vont que dans votre Grist : ni GitHub, ni Albert,
ni ailleurs. La clé d'API n'est jamais écrite dans le code : elle vient de la variable d'environnement
GRIST_API_KEY ou d'un fichier texte (par défaut « cle_grist.txt » à côté des réglages).
Rien à installer : seulement Python 3.8 ou plus récent.

Trois commandes :

  1. Inspecter le fichier (rien n'est envoyé, aucune valeur n'est affichée) :
       python charger_bdd_grist.py inspecter MON_FICHIER.xlsx
     → format, feuilles, lignes, colonnes, taux de remplissage, et un fichier de réglages à compléter
       (reglages_bdd.json).

  2. Essai sur les premières lignes, dans des tables « …_essai » :
       python charger_bdd_grist.py charger MON_FICHIER.xlsx --reglages reglages_bdd.json --essai 1000

  3. Chargement complet :
       python charger_bdd_grist.py charger MON_FICHIER.xlsx --reglages reglages_bdd.json

Le chargement reprend où il s'était arrêté si on le relance après une coupure (fichier « .reprise_… »),
refuse d'écrire dans une table déjà remplie (pas de doublons), ne supprime jamais rien, et vérifie à la fin
que Grist contient autant de lignes que le fichier.
"""

import argparse
import csv
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, timedelta

VERSION = "1.0"


def _n(x):
    """12345 → « 12 345 » (séparateur de milliers à la française)."""
    return f"{x:,}".replace(",", " ")


PAQUET_DEFAUT = 500
ESSAIS_RESEAU = 5

# ─────────────────────────────────────────────────────────────────────────────
#  Lecture du fichier, ligne par ligne (jamais tout en mémoire)
# ─────────────────────────────────────────────────────────────────────────────

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _col_index(ref):
    """« C12 » → 2 (colonne C, en partant de 0)."""
    n = 0
    for ch in ref:
        if ch.isalpha():
            n = n * 26 + (ord(ch.upper()) - 64)
        else:
            break
    return n - 1


def feuilles_xlsx(chemin):
    """Liste des feuilles d'un .xlsx : [(nom, chemin interne)]."""
    with zipfile.ZipFile(chemin) as z:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        cibles = {r.get("Id"): r.get("Target") for r in rels}
        out = []
        for s in wb.iter(NS + "sheet"):
            cible = cibles.get(s.get(NS_REL + "id"), "")
            cible = cible.lstrip("/")
            if not cible.startswith("xl/"):
                cible = "xl/" + cible
            out.append((s.get("name"), cible))
        return out


def _chaines_partagees(z):
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    out = []
    with z.open("xl/sharedStrings.xml") as f:
        for ev, el in ET.iterparse(f, events=("end",)):
            if el.tag == NS + "si":
                out.append("".join(t.text or "" for t in el.iter(NS + "t")))
                el.clear()
    return out


def lignes_xlsx(chemin, feuille=None):
    """Lignes d'une feuille .xlsx, une par une (listes de valeurs ; cases vides = '')."""
    feuilles = feuilles_xlsx(chemin)
    if not feuilles:
        return
    interne = feuilles[0][1]
    if feuille:
        trouve = [c for (n, c) in feuilles if n == feuille]
        if not trouve:
            raise SystemExit(f"Feuille « {feuille} » introuvable. Feuilles : {', '.join(n for n, _ in feuilles)}")
        interne = trouve[0]
    with zipfile.ZipFile(chemin) as z:
        partagees = _chaines_partagees(z)
        with z.open(interne) as f:
            ligne = {}
            numero = 0  # numéro de la dernière ligne rendue (les lignes vides absentes du fichier sont rendues vides)
            for ev, el in ET.iterparse(f, events=("end",)):
                if el.tag == NS + "c":
                    ref = el.get("r") or ""
                    t = el.get("t")
                    v = el.find(NS + "v")
                    if t == "s" and v is not None:
                        val = partagees[int(v.text)]
                    elif t == "inlineStr":
                        val = "".join(x.text or "" for x in el.iter(NS + "t"))
                    elif t == "b" and v is not None:
                        val = "VRAI" if v.text == "1" else "FAUX"
                    elif v is not None and v.text is not None:
                        val = v.text
                        if t not in ("str", "e"):
                            try:
                                num = float(val)
                                val = int(num) if num.is_integer() else num
                            except ValueError:
                                pass
                    else:
                        val = ""
                    idx = _col_index(ref) if ref else len(ligne)
                    ligne[idx] = val
                elif el.tag == NS + "row":
                    r = el.get("r")
                    if r and r.isdigit():
                        while numero < int(r) - 1:
                            numero += 1
                            yield []
                    numero += 1
                    if ligne:
                        n = max(ligne) + 1
                        yield [ligne.get(i, "") for i in range(n)]
                    else:
                        yield []
                    ligne = {}
                    el.clear()


def _ouvrir_texte(chemin):
    """Ouvre un CSV en UTF-8 (avec ou sans BOM), sinon Windows-1252."""
    with open(chemin, "rb") as f:
        debut = f.read(1 << 20)
    try:
        debut.decode("utf-8")
        enc = "utf-8-sig"
    except UnicodeDecodeError:
        enc = "cp1252"
    return open(chemin, "r", encoding=enc, newline="")


def lignes_csv(chemin):
    with _ouvrir_texte(chemin) as f:
        echantillon = f.read(65536)
        f.seek(0)
        sep = ";" if echantillon.count(";") >= echantillon.count(",") else ","
        if echantillon.count("\t") > max(echantillon.count(";"), echantillon.count(",")):
            sep = "\t"
        for ligne in csv.reader(f, delimiter=sep):
            yield [_nombre_csv(x) for x in ligne]


def _nombre_csv(x):
    s = x.strip()
    if re.fullmatch(r"-?\d+", s) and not (len(s) > 1 and s.startswith("0")):
        return int(s)
    if re.fullmatch(r"-?\d+[.,]\d+", s):
        return float(s.replace(",", "."))
    return s


def format_fichier(chemin):
    with open(chemin, "rb") as f:
        tete = f.read(4)
    if tete.startswith(b"PK"):
        return "xlsx"
    if chemin.lower().endswith((".xls",)) and tete.startswith(b"\xd0\xcf"):
        return "xls"
    return "csv"


def lignes_fichier(chemin, feuille=None):
    fmt = format_fichier(chemin)
    if fmt == "xlsx":
        return lignes_xlsx(chemin, feuille)
    if fmt == "xls":
        raise SystemExit("Ancien format Excel (.xls) : ouvrez-le dans Excel et « Enregistrer sous » → Classeur Excel (.xlsx) ou CSV UTF-8.")
    return lignes_csv(chemin)


def _vide(v):
    return v is None or (isinstance(v, str) and v.strip() == "")


def detecter_entete(premieres):
    """Ligne d'en-têtes = celle (parmi les 30 premières) qui a le plus de cases de texte remplies.
    Les lignes de titre des exports (« Export du 12/06/2025 ») n'ont qu'une ou deux cases."""
    meilleur, score_max = 0, -1
    for i, l in enumerate(premieres[:30]):
        score = sum(1 for v in l if isinstance(v, str) and v.strip())
        if score > score_max:
            meilleur, score_max = i, score
    return meilleur


# ─────────────────────────────────────────────────────────────────────────────
#  Inspection : aucune valeur n'est affichée ni envoyée
# ─────────────────────────────────────────────────────────────────────────────

# Colonnes nominatives (nom, prénom de l'élève) : laissées de côté par défaut (minimisation des données, RGPD).
# « Nom complément. étab national élève » est le nom d'un ÉTABLISSEMENT : il n'est pas concerné.
NOMINATIVES = re.compile(r"^(nom|prenom|prénom|nom de famille|nom d'usage)( (de l'|de l |du |d'|d )?(eleve|élève|candidat|candidate))?$"
                         r"|^(eleve|élève|candidat|candidate)$|^(nom|prénom|prenom) (eleve|élève|candidat)", re.I)
CLE_ELEVE = re.compile(r"(identifiant|numero|numéro|n°|\bine\b|\bid\b|\bnum\b).*(eleve|élève|candidat)|(eleve|élève|candidat).*(identifiant|numero|numéro|\bine\b|\bid\b)", re.I)
CLE_OFFRE = re.compile(r"(code|identifiant|numero|numéro).*(voeu|vœu)|(voeu|vœu).*(code|identifiant)", re.I)
PAS_CLE_OFFRE = re.compile(r"avis|d[ée]cision|d[ée]partement|r[ée]sultat|rang|bonus", re.I)


def _norm_entete(h):
    return re.sub(r"\s+", " ", str(h).strip())


def proposer_tables(entetes, stats, cle_e, cle_o, garder_noms=False):
    """Range chaque colonne : Élèves (même valeur pour tous les vœux d'un élève), Offre (même valeur pour un même
    code vœu), Vœux (le reste). Renvoie (eleves, offre, voeux, ecartees) — listes de noms de colonnes."""
    eleves, offre, voeux, ecartees = [], [], [], []
    for j, h in enumerate(entetes):
        if not garder_noms and NOMINATIVES.search(_norm_entete(h)):
            ecartees.append(h)
            continue
        if h == cle_e:
            eleves.append(h); voeux.append(h); continue
        if h == cle_o:
            offre.append(h); voeux.append(h); continue
        const_e = cle_e is not None and stats["viol"].get(cle_e, {}).get(j, 1) == 0
        const_o = cle_o is not None and stats["viol"].get(cle_o, {}).get(j, 1) == 0
        if const_e and const_o:
            (offre if re.search(r"voeu|vœu|accueil", h, re.I) else eleves).append(h)
        elif const_e:
            eleves.append(h)
        elif const_o:
            offre.append(h)
        else:
            voeux.append(h)
    return eleves, offre, voeux, ecartees


def inspecter(chemin, feuille=None, sortie_reglages="reglages_bdd.json", cle_eleve=None, cle_offre=None,
              sans_offre=False, garder_noms=False, ecarter=None, regrouper=None, indicateurs=None):
    fmt = format_fichier(chemin)
    taille = os.path.getsize(chemin)
    print(f"Fichier : {os.path.basename(chemin)} — {taille / 1e6:.1f} Mo — format {fmt.upper()}")
    if fmt == "xlsx":
        fs = feuilles_xlsx(chemin)
        print(f"Feuilles : {len(fs)} ({', '.join(n for n, _ in fs)})")
        if not feuille and len(fs) > 1:
            print("  → plusieurs feuilles : la première est inspectée ; ajoutez --feuille NOM pour une autre.")
    it = lignes_fichier(chemin, feuille)
    premieres = []
    for l in it:
        premieres.append(l)
        if len(premieres) >= 30:
            break
    if not premieres:
        raise SystemExit("Fichier vide.")
    i_ent = detecter_entete(premieres)
    entetes = [_norm_entete(h) if not _vide(h) else f"Colonne {j + 1}" for j, h in enumerate(premieres[i_ent])]
    nb = len(entetes)
    ecarter = [_norm_entete(c) for c in (ecarter or [])]
    regrouper = [_norm_entete(c) for c in (regrouper or [])]
    indicateurs = [_norm_entete(c) for c in (indicateurs or [])]
    if set(indicateurs) & set(ecarter) or set(regrouper) & set(ecarter):
        raise SystemExit("Une même colonne ne peut pas être à la fois écartée et gardée (--regrouper / --indicateurs).")
    inconnues = [c for c in ecarter + regrouper + indicateurs if c not in entetes]
    if inconnues:
        raise SystemExit("Colonne(s) absente(s) du fichier : " + ", ".join(f"« {c} »" for c in dict.fromkeys(inconnues)))
    for c, quoi in ((cle_eleve, "--cle-eleve"), (cle_offre, "--cle-offre")):
        if c and c not in entetes:
            raise SystemExit(f"{quoi} : colonne « {c} » absente du fichier.")
    # identifiants candidats, d'après les noms de colonnes (vérifiés ensuite sur les données)
    cand_e = [cle_eleve] if cle_eleve else [h for h in entetes if CLE_ELEVE.search(h) and not NOMINATIVES.search(h)]
    cand_o = [] if sans_offre else ([cle_offre] if cle_offre else [h for h in entetes if CLE_OFFRE.search(h) and not PAS_CLE_OFFRE.search(h)])
    cand_o = [h for h in cand_o if h not in cand_e]
    pos = {h: j for j, h in enumerate(entetes)}
    remplies = [0] * nb
    nombres = [0] * nb
    premieres_val = {c: {} for c in cand_e + cand_o}   # clé → valeurs de la première ligne de cette clé
    viol = {c: [0] * nb for c in cand_e + cand_o}       # colonnes qui changent pour une même clé
    constantes = {c: list(range(nb)) for c in cand_e + cand_o}  # colonnes encore constantes (les seules comparées)
    groupes = set()
    j_grp = [entetes.index(c) for c in regrouper]
    total = 0

    def compter(l):
        nonlocal total
        if not any(not _vide(v) for v in l):
            return
        total += 1
        if len(l) < nb:
            l = l + [""] * (nb - len(l))
        for j in range(nb):
            v = l[j]
            if not _vide(v):
                remplies[j] += 1
                if isinstance(v, (int, float)):
                    nombres[j] += 1
        if j_grp:
            groupes.add(tuple(l[j] for j in j_grp))
        for c, vus in premieres_val.items():
            k = l[pos[c]]
            if _vide(k):
                continue
            ref = vus.get(k)
            if ref is None:
                vus[k] = tuple(l[:nb])
            else:
                restantes = constantes[c]
                if restantes:
                    changees = [j for j in restantes if ref[j] != l[j]]
                    if changees:
                        vc = viol[c]
                        for j in changees:
                            vc[j] += 1
                        constantes[c] = [j for j in restantes if not vc[j]]

    for l in premieres[i_ent + 1:]:
        compter(l)
    debut = time.time()
    for l in it:
        compter(l)
        if total and total % 200000 == 0:
            print(f"  … {_n(total)} lignes lues ({time.time() - debut:.0f} s)")
    print(f"Ligne d'en-têtes : {i_ent + 1}")
    print(f"Lignes de données : {_n(total)}")
    print(f"Colonnes : {nb}  → {_n(total * nb)} cases")

    # identifiant retenu : celui qui se répète (plusieurs lignes par valeur) avec le plus de valeurs
    def choisir(cands):
        ok = [c for c in cands if 0 < len(premieres_val[c]) < total]
        return max(ok, key=lambda c: len(premieres_val[c])) if ok else None
    cle_e = choisir(cand_e)
    cle_o = choisir(cand_o)
    stats = {"viol": {c: {j: n for j, n in enumerate(v)} for c, v in viol.items()}}
    print("")
    if cle_e:
        n_e = len(premieres_val[cle_e])
        print(f"Identifiant de l'élève : « {cle_e} » — {_n(n_e)} élèves, {total / n_e:.1f} lignes par élève en moyenne.")
    else:
        print("Aucun identifiant d'élève qui se répète : une seule table (ou indiquez-le avec --cle-eleve).")
    if cle_o:
        print(f"Identifiant du vœu (offre) : « {cle_o} » — {_n(len(premieres_val[cle_o]))} vœux possibles différents.")
    eleves, offre, voeux, ecartees = proposer_tables(entetes, stats, cle_e, cle_o, garder_noms)
    # colonnes de regroupement et indicateurs : toujours dans la table des vœux (une ligne par vœu)
    for c in regrouper + indicateurs:
        if c not in voeux:
            voeux.append(c)
        if c in eleves and c != cle_e:
            eleves.remove(c)
        if c in offre and c != cle_o:
            offre.remove(c)
    if ecarter:
        if cle_e in ecarter or cle_o in ecarter:
            raise SystemExit("--ecarter : on ne peut pas écarter un identifiant (il relie les tables).")
        eleves = [h for h in eleves if h not in ecarter]
        offre = [h for h in offre if h not in ecarter]
        voeux = [h for h in voeux if h not in ecarter]
        ecartees = ecartees + [h for h in ecarter if h not in ecartees]
    if not cle_e:
        eleves = []
    if not cle_o:
        offre = []
    dest = {}
    for nom_t, cols in (("Élèves", eleves), ("Offre", offre), ("Vœux", voeux)):
        for h in cols:
            dest.setdefault(h, []).append(nom_t)
    print("")
    print(f"{'N°':>3}  {'Remplie':>8}  {'Type':<7}  {'Table(s)':<15}  Colonne")
    for j, h in enumerate(entetes):
        taux = (remplies[j] / total * 100) if total else 0
        typ = "nombre" if remplies[j] and nombres[j] >= 0.95 * remplies[j] else "texte"
        t = " + ".join(dest.get(h, [])) or "écartée"
        print(f"{j + 1:>3}  {taux:>7.1f}%  {typ:<7}  {t:<15}  {h}")
    print("")
    if cle_e:
        n_e = len(premieres_val[cle_e])
        n_o = len(premieres_val[cle_o]) if cle_o else 0
        n_v = len(groupes) if regrouper else total
        cases = n_e * len(eleves) + n_o * len(offre) + n_v * len(voeux)
        print("Tables proposées :")
        print(f"  Élèves : {_n(n_e)} lignes × {len(eleves)} colonnes")
        if cle_o:
            print(f"  Offre  : {_n(n_o)} lignes × {len(offre)} colonnes")
        print(f"  Vœux   : {_n(n_v)} lignes × {len(voeux)} colonnes" + (f" (après regroupement des {_n(total)} lignes du fichier)" if regrouper else ""))
        print(f"  → {_n(cases)} cases au lieu de {_n(total * nb)} ({cases / max(1, total * nb) * 100:.0f} %)")
    noms = [h for h in ecartees if h not in ecarter]
    if noms:
        print(f"Colonnes écartées (nom ou prénom d'élève, non chargés) : {', '.join(f'« {h} »' for h in noms)}")
        print("  (pour les garder quand même : ajoutez --garder-noms)")
    if ecarter:
        print(f"Colonnes écartées à votre demande : {', '.join(f'« {h} »' for h in ecarter)}")
    # totaux déjà calculés par l'outil d'export, remplis sur une partie des lignes : les additionner ligne à ligne
    # compterait plusieurs fois les mêmes élèves
    totaux = [h for j, h in enumerate(entetes) if h in voeux and h not in indicateurs and re.match(r"(nombre|nb|somme|total|compteur)\b", h, re.I)
              and remplies[j] and nombres[j] >= 0.95 * remplies[j] and (remplies[j] < total or re.match(r"(somme|total)", h, re.I))]
    if totaux:
        print("")
        print("Attention : " + ", ".join(f"« {h} »" for h in totaux) + " ressemblent à des totaux déjà calculés par l'export "
              "(ils ne décrivent pas un vœu). Additionnés ligne à ligne, ils compteraient plusieurs fois les mêmes élèves ; "
              "Grist et le widget savent les recalculer à partir des vœux. Pour ne pas les charger : --ecarter "
              + " ".join(f'"{h}"' for h in totaux))

    # Réglages : aucun contenu du fichier, seulement les noms de colonnes
    principale = {"nom": "Voeux" if cle_e else "Donnees", "colonnes": {h: (f"{h} (oui/non)" if h in indicateurs else h) for h in voeux}}
    if regrouper:
        principale["regrouper"] = regrouper
        print(f"Regroupement : les lignes qui ont les mêmes « {' », « '.join(regrouper)} » forment UN vœu ({_n(len(groupes))} vœux).")
    if indicateurs:
        principale["indicateurs"] = indicateurs
        print(f"Indicateurs (rempli → « Oui », vide → « Non ») : {', '.join(f'« {h} »' for h in indicateurs)}")
    references = []
    if cle_e:
        references.append({"nom": "Eleves", "cle": cle_e, "colonnes": {h: h for h in eleves}})
    if cle_o:
        references.append({"nom": "Offre", "cle": cle_o, "colonnes": {h: h for h in offre}})
    reglages = {
        "grist": {"serveur": "https://grist.numerique.gouv.fr", "document": "ID_DU_DOCUMENT"},
        "cle_api_fichier": "cle_grist.txt",
        "feuille": feuille,
        "ligne_entete": i_ent + 1,
        "paquet": PAQUET_DEFAUT,
        "tables": {"principale": principale, "references": references, "ecartees": ecartees},
        "_aide": ("« principale » : une ligne par ligne du fichier ; « references » : une ligne par valeur de « cle ». "
                  "Chaque colonne : nom dans le fichier → nom dans Grist (vous pouvez le raccourcir). "
                  "Supprimez une ligne pour ne pas charger la colonne. Remplacez ID_DU_DOCUMENT par l'ID du document Grist."),
    }
    if sortie_reglages:
        cible = sortie_reglages
        if os.path.exists(cible):
            try:
                with open(cible, encoding="utf-8") as f:
                    ancien = json.load(f)
                vierge = (ancien.get("grist") or {}).get("document") in (None, "", "ID_DU_DOCUMENT")
            except (ValueError, OSError):
                vierge = False
            if not vierge:
                base, ext = os.path.splitext(cible)
                cible = f"{base}_nouveau{ext or '.json'}"
                print(f"\n{sortie_reglages} est déjà complété : il n'est pas remplacé.")
        with open(cible, "w", encoding="utf-8") as f:
            json.dump(reglages, f, ensure_ascii=False, indent=2)
        print(f"\nRéglages préparés : {cible}")
    return {"format": fmt, "lignes": total, "colonnes": entetes, "ligne_entete": i_ent + 1, "cle_eleve": cle_e,
            "cle_offre": cle_o, "eleves": eleves, "offre": offre, "voeux": voeux, "ecartees": ecartees,
            "nb_eleves": len(premieres_val[cle_e]) if cle_e else None, "nb_offres": len(premieres_val[cle_o]) if cle_o else None}


# ─────────────────────────────────────────────────────────────────────────────
#  Grist (API)
# ─────────────────────────────────────────────────────────────────────────────

def id_colonne(nom, pris):
    """Nom de colonne Grist valide (lettres, chiffres, _), unique."""
    s = str(nom).replace("œ", "oe").replace("Œ", "Oe").replace("æ", "ae").replace("Æ", "Ae")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_") or "Colonne"
    if not s[0].isalpha():
        s = "C_" + s
    s = s[:60]
    pris.update({"id", "manualsort"})  # colonnes réservées par Grist
    base, k = s, 2
    while s.lower() in pris:
        s = f"{base}_{k}"
        k += 1
    pris.add(s.lower())
    return s


def id_table(nom):
    s = id_colonne(nom, set())
    return s[0].upper() + s[1:]


class Grist:
    def __init__(self, serveur, document, cle, pause=None):
        self.base = serveur.rstrip("/") + "/api/docs/" + document
        self.cle = cle
        # attente entre deux essais (1 s, 2 s, 4 s…) ; réglable pour les tests
        self.pause = pause if pause is not None else float(os.environ.get("CHARGEUR_PAUSE", "1"))
        self.requetes = 0

    def _appel(self, methode, chemin, corps=None):
        url = self.base + chemin
        donnees = json.dumps(corps).encode("utf-8") if corps is not None else None
        derniere = None
        for essai in range(ESSAIS_RESEAU):
            req = urllib.request.Request(url, data=donnees, method=methode)
            req.add_header("Authorization", "Bearer " + self.cle)
            if donnees is not None:
                req.add_header("Content-Type", "application/json")
            try:
                self.requetes += 1
                with urllib.request.urlopen(req, timeout=120) as r:
                    txt = r.read().decode("utf-8")
                    return json.loads(txt) if txt else {}
            except urllib.error.HTTPError as e:
                derniere = e
                if e.code in (401, 403):
                    raise SystemExit("Accès refusé par Grist (clé d'API incorrecte, ou pas de droit d'écriture sur ce document).")
                if e.code == 404:
                    raise SystemExit("Document ou table introuvable dans Grist : vérifiez l'ID du document dans les réglages.")
                if e.code not in (429, 500, 502, 503, 504):
                    raise SystemExit(f"Grist a refusé l'envoi (erreur {e.code}) : {e.read().decode('utf-8', 'ignore')[:300]}")
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                derniere = e
            time.sleep(self.pause * (2 ** essai))
        raise ConnectionError(f"Grist ne répond pas après {ESSAIS_RESEAU} essais ({derniere}).")

    def tables(self):
        return [t["id"] for t in self._appel("GET", "/tables").get("tables", [])]

    def creer_table(self, tid, colonnes):
        """colonnes : [(id, libellé, type Grist)]"""
        corps = {"tables": [{"id": tid, "columns": [{"id": c, "fields": {"label": l, "type": t}} for c, l, t in colonnes]}]}
        r = self._appel("POST", "/tables", corps)
        return (r.get("tables") or [{"id": tid}])[0]["id"]

    def nombre_lignes(self, tid):
        try:
            r = self._appel("GET", "/sql?q=" + urllib.parse.quote(f'SELECT COUNT(*) AS n FROM "{tid}"'))
            return int(r["records"][0]["fields"]["n"])
        except (KeyError, IndexError, ValueError, SystemExit):
            return None

    def ajouter(self, tid, enregistrements):
        self._appel("POST", f"/tables/{tid}/records", {"records": [{"fields": e} for e in enregistrements]})



# ─────────────────────────────────────────────────────────────────────────────
#  Chargement
# ─────────────────────────────────────────────────────────────────────────────

def lire_cle(reglages, dossier):
    cle = os.environ.get("GRIST_API_KEY", "").strip()
    if cle:
        return cle
    chemin = reglages.get("cle_api_fichier") or "cle_grist.txt"
    if not os.path.isabs(chemin):
        chemin = os.path.join(dossier, chemin)
    if os.path.exists(chemin):
        with open(chemin, encoding="utf-8") as f:
            cle = f.read().strip()
    if not cle:
        raise SystemExit("Clé d'API Grist absente : mettez-la dans le fichier « cle_grist.txt » à côté des réglages "
                         "(Grist → Paramètres du profil → API), ou dans la variable d'environnement GRIST_API_KEY.")
    return cle


def _convertir(v, typ):
    if _vide(v):
        return None
    if typ == "Numeric":
        if isinstance(v, (int, float)):
            return v
        try:
            return float(str(v).replace(",", ".").replace(" ", ""))
        except ValueError:
            return str(v)
    if typ == "Date":
        if isinstance(v, (int, float)):
            # date Excel (jours depuis le 30/12/1899) → texte AAAA-MM-JJ
            return (date(1899, 12, 30) + timedelta(days=int(v))).isoformat()
        return str(v)
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _type_colonne(nom_grist, nom_source, types_forces, echantillon_nombres):
    if nom_source in types_forces:
        return types_forces[nom_source]
    if re.search(r"\bdate\b", nom_source, re.I) and echantillon_nombres:
        return "Date"  # date Excel (nombre de jours) ; une date écrite en texte reste du texte
    return "Numeric" if echantillon_nombres else "Text"


def _tables_reglages(R):
    """Réglages → (principale, références). Accepte aussi l'ancienne forme {eleves, voeux}."""
    T = R.get("tables") or {}
    if "principale" in T:
        return T["principale"], [t for t in (T.get("references") or []) if t and t.get("cle") and t.get("colonnes")]
    tv, te = T.get("voeux"), T.get("eleves")
    refs = [te] if (te and te.get("cle") and te.get("colonnes")) else []
    return tv, refs


def charger(chemin, chemin_reglages, essai=None, grist=None, sortie=print, document=None):
    dossier = os.path.dirname(os.path.abspath(chemin_reglages))
    with open(chemin_reglages, encoding="utf-8") as f:
        R = json.load(f)
    if document:
        R.setdefault("grist", {})["document"] = document.strip()
    if grist is None:
        g = R.get("grist") or {}
        if not g.get("document") or g["document"] == "ID_DU_DOCUMENT":
            raise SystemExit("Indiquez l'ID du document Grist : ajoutez --document SON_ID à la commande "
                             "(Grist → Paramètres du document → ID du document).")
        grist = Grist(g.get("serveur") or "https://grist.numerique.gouv.fr", g["document"], lire_cle(R, dossier))
    paquet = int(R.get("paquet") or PAQUET_DEFAUT)
    tp, refs = _tables_reglages(R)
    if not tp or not tp.get("colonnes"):
        raise SystemExit("Réglages : la table principale (« principale » ou « voeux ») doit lister ses colonnes.")
    suffixe = "_essai" if essai else ""
    types_forces = R.get("types") or {}
    cles = {t["cle"] for t in refs}

    it = lignes_fichier(chemin, R.get("feuille"))
    i_ent = int(R.get("ligne_entete") or 1) - 1
    for _ in range(i_ent):
        next(it, None)
    entetes = [_norm_entete(h) for h in (next(it, None) or [])]
    pos = {h: j for j, h in enumerate(entetes)}
    manquantes = [c for t in [tp] + refs for c in list(t["colonnes"]) + ([t["cle"]] if t.get("cle") else []) if c not in pos]
    if manquantes:
        raise SystemExit("Colonnes absentes du fichier : " + ", ".join(f"« {c} »" for c in dict.fromkeys(manquantes)))

    # Échantillon (200 lignes) pour deviner les types ; les lignes sont gardées pour l'envoi
    tampon = []
    for l in it:
        tampon.append(l)
        if len(tampon) >= 200:
            break

    def est_nombre(nom):
        vals = [l[pos[nom]] for l in tampon if pos[nom] < len(l) and not _vide(l[pos[nom]])]
        return bool(vals) and all(isinstance(v, (int, float)) for v in vals)

    def plan_table(t, liens):
        """[(colonne source, id Grist, libellé, type)] ; la clé et les liens vers les autres tables sont du texte."""
        pris, cols = set(), []
        obligatoires = ([t["cle"]] if t.get("cle") else []) + [c for c in liens if c not in t["colonnes"]]
        for src in obligatoires:
            nom = t["colonnes"].get(src, src)
            cols.append((src, id_colonne(nom, pris), nom, "Text"))
        for src, nom in t["colonnes"].items():
            if src in obligatoires:
                continue
            typ = "Text" if src in cles else _type_colonne(nom, src, types_forces, est_nombre(src))
            cols.append((src, id_colonne(nom, pris), nom, typ))
        return cols

    plans = [{"role": "principale", "tid": id_table(tp.get("nom") or "Donnees") + suffixe, "cols": plan_table(tp, [t["cle"] for t in refs])}]
    for t in refs:
        plans.append({"role": "reference", "cle": t["cle"], "tid": id_table(t.get("nom") or t["cle"]) + suffixe, "cols": plan_table(t, [])})
    regrouper = [_norm_entete(c) for c in (tp.get("regrouper") or [])]
    indicateurs = {_norm_entete(c) for c in (tp.get("indicateurs") or [])}
    absentes = [c for c in regrouper + sorted(indicateurs) if c not in pos]
    if absentes:
        raise SystemExit("Colonnes de regroupement ou indicateurs absentes du fichier : " + ", ".join(f"« {c} »" for c in absentes))
    if indicateurs:
        for i, (src, cid, lib, typ) in enumerate(plans[0]["cols"]):
            if src in indicateurs:
                plans[0]["cols"][i] = (src, cid, lib, "Text")
    if len({p["tid"].lower() for p in plans}) < len(plans):
        raise SystemExit("Réglages : deux tables ont le même nom.")

    # Reprise : où en était-on ?
    fichier_reprise = os.path.join(dossier, f".reprise_{plans[0]['tid']}.json")
    reprise = {}
    if os.path.exists(fichier_reprise):
        with open(fichier_reprise, encoding="utf-8") as f:
            reprise = json.load(f)
        if reprise.get("fichier") != os.path.basename(chemin) or reprise.get("taille") != os.path.getsize(chemin):
            raise SystemExit(f"Un chargement d'un autre fichier est en cours ({fichier_reprise}). Supprimez ce fichier pour recommencer.")
        sortie("Un chargement précédent de ce fichier n'est pas terminé : il va être complété.")

    existantes = grist.tables()
    for p in plans:
        if p["tid"] in existantes:
            n = grist.nombre_lignes(p["tid"])
            if not reprise and n:
                raise SystemExit(f"La table « {p['tid']} » existe déjà dans Grist et contient {n} lignes : pour éviter les doublons, "
                                 "rien n'est envoyé. Choisissez un autre nom de table dans les réglages, ou un autre document.")
        else:
            p["tid"] = grist.creer_table(p["tid"], [(c, l, t) for _, c, l, t in p["cols"]])

    # Ce que Grist contient déjà fait foi (un envoi est tout ou rien) ; à défaut, le fichier de reprise
    deja_reprise = reprise.get("envoyes") or {}
    for p in plans:
        p["deja"] = 0
        if reprise:
            n0 = grist.nombre_lignes(p["tid"])
            p["deja"] = n0 if n0 is not None else int(deja_reprise.get(p["tid"], 0))
        p["envoyes"], p["lot"], p["vus"] = p["deja"], [], set()
    if reprise:
        sortie("Reprise : " + ", ".join(f"{_n(p['deja'])} lignes dans « {p['tid']} »" for p in plans) + ".")
    principale = plans[0]
    groupes = {}      # regroupement : clé → enregistrement (ordre de première apparition, le même à chaque lancement)
    conflits = {}     # colonnes dont la valeur change entre les lignes d'un même vœu (la première est gardée)
    lu = 0  # lignes de données lues (non vides)
    debut = time.time()

    def sauver_reprise():
        tmp = fichier_reprise + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"fichier": os.path.basename(chemin), "taille": os.path.getsize(chemin),
                       "envoyes": {p["tid"]: p["envoyes"] for p in plans}, "version": VERSION}, f)
        os.replace(tmp, fichier_reprise)

    sauver_reprise()

    def envoyer():
        # les tables de référence d'abord, puis la table principale
        for p in plans[1:] + plans[:1]:
            if p["lot"]:
                grist.ajouter(p["tid"], p["lot"])
                p["envoyes"] += len(p["lot"])
                p["lot"] = []
                sauver_reprise()

    def source():
        for l in tampon:
            yield l
        for l in it:
            yield l

    for l in source():
        if not any(not _vide(v) for v in l):
            continue
        if essai and lu >= essai:
            break
        lu += 1
        val = lambda src: l[pos[src]] if pos[src] < len(l) else ""
        for p in plans[1:]:
            cle = _convertir(val(p["cle"]), "Text")
            if cle is not None and cle not in p["vus"]:
                rang = len(p["vus"])  # ordre de première apparition : le même à chaque lancement
                p["vus"].add(cle)
                if rang >= p["deja"]:
                    p["lot"].append({c: _convertir(val(src), t) for src, c, _, t in p["cols"]})
        def valeur(src, t):
            if src in indicateurs:
                return "Non" if _vide(val(src)) or val(src) == 0 else "Oui"
            return _convertir(val(src), t)
        if regrouper:
            cle_g = tuple(_convertir(val(c), "Text") for c in regrouper)
            rec = groupes.get(cle_g)
            if rec is None:
                groupes[cle_g] = {c: valeur(src, t) for src, c, _, t in principale["cols"]}
            else:
                for src, c, _, t in principale["cols"]:
                    v = valeur(src, t)
                    if src in indicateurs:
                        if v == "Oui":
                            rec[c] = "Oui"
                    elif rec[c] != v:
                        conflits[src] = conflits.get(src, 0) + 1
        elif lu > principale["deja"]:
            principale["lot"].append({c: valeur(src, t) for src, c, _, t in principale["cols"]})
        if any(len(p["lot"]) >= paquet for p in plans):
            envoyer()
            if lu % (paquet * 20) == 0:
                vitesse = (lu - principale["deja"]) / max(1e-6, time.time() - debut)
                sortie(f"  … {_n(lu)} lignes envoyées ({vitesse:.0f} lignes/s)")
    envoyer()
    if regrouper:
        sortie(f"{_n(lu)} lignes lues → {_n(len(groupes))} vœux après regroupement ; envoi des vœux…")
        recs = list(groupes.values())
        for k in range(principale["deja"], len(recs), paquet):
            principale["lot"] = recs[k:k + paquet]
            envoyer()
            if (k // paquet) % 20 == 19:
                sortie(f"  … {_n(min(k + paquet, len(recs)))} vœux envoyés")
        if conflits:
            sortie("Colonnes qui changent entre les lignes d'un même vœu (la première valeur est gardée) : "
                   + ", ".join(f"« {c} » ({_n(n)})" for c, n in sorted(conflits.items(), key=lambda x: -x[1])))

    # Vérification : Grist contient-il tout ?
    sortie("")
    ok = True
    for p in plans:
        attendu = (len(groupes) if regrouper else lu) if p["role"] == "principale" else len(p["vus"])
        quoi = ("vœux après regroupement" if regrouper else "lignes") if p["role"] == "principale" else f"valeurs différentes de « {p['cle']} »"
        n = grist.nombre_lignes(p["tid"])
        if n is None:
            sortie(f"Vérification impossible pour « {p['tid']} » (Grist n'a pas donné son nombre de lignes) : {attendu} attendues.")
            ok = False
        elif n != attendu:
            sortie(f"INCOMPLET : « {p['tid']} » contient {n} lignes dans Grist ; le fichier a {attendu} {quoi}.")
            ok = False
        else:
            sortie(f"« {p['tid']} » : {_n(n)} lignes, identique au fichier ({_n(attendu)} {quoi}).")
    if ok:
        sortie("Chargement complet et vérifié." + (" (essai : tables « …_essai »)" if essai else ""))
        if len(plans) > 1:
            sortie("Pour relier les tables dans Grist : dans la table principale, changez le type des colonnes "
                   + ", ".join(f"« {p['cle']} »" for p in plans[1:]) + " en « Référence » vers la table correspondante.")
        os.remove(fichier_reprise)
    else:
        sortie("Relancez la même commande pour compléter : le chargement reprendra où il s'est arrêté.")
    return {"ok": ok, "lignes": lu, "tables": [p["tid"] for p in plans],
            "references": {p["tid"]: len(p["vus"]) for p in plans[1:]}, "requetes": grist.requetes}


def resume_decisions(chemin, colonne=None, rang=None, cle_eleve=None, feuille=None, sortie=print):
    """Statistiques agrégées sur un code de décision (aucune valeur d'élève n'est affichée) : pour chaque code, le nombre
    de lignes et d'élèves, s'il apparaît plusieurs fois pour un même élève, et sa place par rapport au code qui n'apparaît
    qu'une fois par élève. Règle Affelnet : un élève est affecté sur un seul vœu ; liste supplémentaire sur les vœux mieux
    classés, refusé sur les vœux moins bien classés. Sert à deviner quel code veut dire « affecté »."""
    it = lignes_fichier(chemin, feuille)
    premieres = []
    for l in it:
        premieres.append(l)
        if len(premieres) >= 30:
            break
    i_ent = detecter_entete(premieres)
    entetes = [_norm_entete(h) for h in premieres[i_ent]]
    def trouver(nom, motif, quoi):
        if nom:
            if nom not in entetes:
                raise SystemExit(f"{quoi} : colonne « {nom} » absente du fichier.")
            return nom
        c = [h for h in entetes if re.search(motif, h, re.I)]
        if not c:
            raise SystemExit(f"{quoi} : aucune colonne trouvée ; indiquez-la avec l'option correspondante.")
        return c[0]
    col = trouver(colonne, r"d[ée]cision", "--colonne (décision)")
    col_r = trouver(rang, r"^rang\b|\brang (du )?v(oe|œ)u", "--rang")
    col_e = trouver(cle_eleve, CLE_ELEVE.pattern, "--cle-eleve")
    jd, jr, je = entetes.index(col), entetes.index(col_r), entetes.index(col_e)
    nb = len(entetes)
    par_eleve = {}
    total = 0
    # structure : lignes d'un même élève pour un même rang, et ce qui les distingue (aucune valeur gardée à l'écran)
    premiere_paire = {}
    paires_multiples = set()
    differe = [0] * nb
    # petites colonnes de codes (≤ 15 valeurs) : leurs valeurs sont des codes, pas des données d'élève
    exclues = {j for j, h in enumerate(entetes) if NOMINATIVES.search(h) or CLE_ELEVE.search(h) or j == je}
    petites = {j: {} for j in range(nb) if j not in exclues}
    def lire(l):
        nonlocal total
        if not any(not _vide(v) for v in l):
            return
        total += 1
        g = lambda j: l[j] if j < len(l) else ""
        code = "" if _vide(g(jd)) else str(int(g(jd)) if isinstance(g(jd), float) and g(jd).is_integer() else g(jd)).strip()
        try:
            r = float(g(jr))
        except (TypeError, ValueError):
            r = None
        par_eleve.setdefault(g(je), []).append((r, code))
        cle = (g(je), r)
        ligne = tuple(g(j) for j in range(nb))
        ref = premiere_paire.get(cle)
        if ref is None:
            premiere_paire[cle] = ligne
        else:
            paires_multiples.add(cle)
            for j in range(nb):
                if ref[j] != ligne[j]:
                    differe[j] += 1
        for j in list(petites):
            v = ligne[j]
            d = petites[j]
            d[v] = d.get(v, 0) + 1
            if len(d) > 15:
                del petites[j]
    for l in premieres[i_ent + 1:]:
        lire(l)
    for l in it:
        lire(l)
    codes = {}
    for k, voeux in par_eleve.items():
        vus = {}
        for r, c in voeux:
            vus[c] = vus.get(c, 0) + 1
        for c, n in vus.items():
            d = codes.setdefault(c, {"lignes": 0, "eleves": 0, "plusieurs": 0, "rang1": 0})
            d["lignes"] += n
            d["eleves"] += 1
            if n > 1:
                d["plusieurs"] += 1
        for r, c in voeux:
            if r == 1:
                codes[c]["rang1"] += 1
    uniques = [c for c, d in codes.items() if d["plusieurs"] == 0 and c != ""]
    pivot = max(uniques, key=lambda c: codes[c]["eleves"]) if uniques else None
    avant, apres = {}, {}
    if pivot is not None:
        for k, voeux in par_eleve.items():
            rp = [r for r, c in voeux if c == pivot and r is not None]
            if not rp:
                continue
            for r, c in voeux:
                if c == pivot or r is None:
                    continue
                (avant if r < rp[0] else apres)[c] = (avant if r < rp[0] else apres).get(c, 0) + 1
    sortie(f"Colonne étudiée : « {col} » — rang : « {col_r} » — élève : « {col_e} »")
    sortie(f"{_n(total)} lignes, {_n(len(par_eleve))} élèves")
    sortie("")
    sortie(f"{'Code':>6}  {'Lignes':>9}  {'Élèves':>8}  {'Plusieurs fois':>15}  {'Sur le vœu 1':>13}  {'Avant / après le code unique':>30}")
    for c in sorted(codes, key=lambda x: (x == "", x)):
        d = codes[c]
        pos = "" if c == pivot or pivot is None else f"{_n(avant.get(c, 0))} avant / {_n(apres.get(c, 0))} après"
        sortie(f"{(c or '(vide)'):>6}  {_n(d['lignes']):>9}  {_n(d['eleves']):>8}  {_n(d['plusieurs']):>15}  {_n(d['rang1']):>13}  {pos:>30}")
    sortie("")
    # Diagnostic de structure
    codes_par_eleve = {k: {c for _, c in v} for k, v in par_eleve.items()}
    un_seul = sum(1 for cs in codes_par_eleve.values() if len(cs) == 1)
    sortie("Structure du fichier :")
    sortie(f"  {_n(un_seul)} élèves ont le même code sur toutes leurs lignes ; {_n(len(par_eleve) - un_seul)} en ont plusieurs différents.")
    if un_seul >= 0.9 * len(par_eleve):
        sortie("  → ce code ressemble à un RÉSULTAT PAR ÉLÈVE (répété sur chacune de ses lignes), pas à une décision par vœu.")
    sortie(f"  {_n(len(premiere_paire))} couples (élève, rang de vœu) différents ; {_n(len(paires_multiples))} ont plusieurs lignes.")
    if paires_multiples:
        top = sorted(((differe[j], entetes[j]) for j in range(nb) if differe[j]), reverse=True)[:8]
        if top:
            sortie("  Colonnes qui changent entre les lignes d'un même élève pour un même rang (nombre de lignes concernées) :")
            for n_, h in top:
                sortie(f"    « {h} » : {_n(n_)}")
        else:
            sortie("  Ces lignes sont des doublons exacts (toutes les colonnes identiques).")
    if petites:
        sortie("")
        sortie("Valeurs des petites colonnes de codes (15 valeurs au plus) :")
        for j, d in petites.items():
            if len(d) < 2:
                continue
            vals = ", ".join(f"{'(vide)' if _vide(v) else v} : {_n(c)}" for v, c in sorted(d.items(), key=lambda x: -x[1]))
            sortie(f"  « {entetes[j]} » — {vals}")
    sortie("")
    if pivot is None:
        sortie("Aucun code n'apparaît au plus une fois par élève : impossible de deviner « affecté » avec la règle « un vœu affecté par élève ».")
        return {"pivot": None, "codes": codes, "un_seul": un_seul, "paires_multiples": len(paires_multiples)}
    sortie(f"Proposition : « {pivot} » = AFFECTÉ (jamais deux fois pour un même élève, {_n(codes[pivot]['eleves'])} élèves).")
    ls = [c for c in codes if c not in (pivot, "") and avant.get(c, 0) > 0 and apres.get(c, 0) <= avant.get(c, 0) * 0.05]
    rf = [c for c in codes if c not in (pivot, "") and apres.get(c, 0) > 0 and avant.get(c, 0) <= apres.get(c, 0) * 0.05]
    if ls:
        sortie(f"  presque toujours AVANT le vœu affecté (mieux classé) : {', '.join(ls)} → probablement LISTE SUPPLÉMENTAIRE")
    if rf:
        sortie(f"  presque toujours APRÈS le vœu affecté (moins bien classé) : {', '.join(rf)} → probablement REFUSÉ")
    sortie("À faire confirmer par le service de l'affectation (DSDEN) avant de s'en servir.")
    return {"pivot": pivot, "codes": codes, "liste": ls, "refus": rf}


def chiffres(chemin, par=None, si=None, non_vide=None, cle_eleve=None, feuille=None, sortie=print):
    """Nombre d'ÉLÈVES différents (et de lignes) répondant aux conditions, éventuellement par catégorie. Aucune donnée
    d'élève n'est affichée : seulement des nombres et des catégories (jamais par nom ni par identifiant)."""
    it = lignes_fichier(chemin, feuille)
    premieres = []
    for l in it:
        premieres.append(l)
        if len(premieres) >= 30:
            break
    i_ent = detecter_entete(premieres)
    entetes = [_norm_entete(h) for h in premieres[i_ent]]
    def verifier(c, quoi):
        if c not in entetes:
            raise SystemExit(f"{quoi} : colonne « {c} » absente du fichier.")
        return entetes.index(c)
    if cle_eleve:
        je = verifier(cle_eleve, "--cle-eleve")
    else:
        cands = [h for h in entetes if CLE_ELEVE.search(h) and not NOMINATIVES.search(h) and re.search(r"identifiant|\bine\b|numero|numéro", h, re.I)]
        if not cands:
            raise SystemExit("Indiquez la colonne de l'identifiant élève avec --cle-eleve.")
        je = entetes.index(cands[0])
    jp = None
    if par:
        jp = verifier(_norm_entete(par), "--par")
        if NOMINATIVES.search(entetes[jp]) or jp == je:
            raise SystemExit("--par : pas de détail par nom ou par identifiant d'élève.")
    conds = []
    for c in (si or []):
        m = re.match(r"^(.+?)\s*(~|=)\s*(.+)$", c)
        if not m:
            raise SystemExit(f"--si « {c} » : écrivez COLONNE=VALEUR (égal) ou COLONNE~TEXTE (contient).")
        conds.append((verifier(_norm_entete(m.group(1)), "--si"), m.group(2), normalizeText_py(m.group(3))))
    nvs = [verifier(_norm_entete(c), "--non-vide") for c in (non_vide or [])]
    eleves, lignes, par_cat = set(), 0, {}
    def lire(l):
        nonlocal lignes
        if not any(not _vide(v) for v in l):
            return
        g = lambda j: l[j] if j < len(l) else ""
        for j, op, v in conds:
            x = normalizeText_py(g(j))
            if (op == "=" and x != v) or (op == "~" and v not in x):
                return
        for j in nvs:
            if _vide(g(j)) or g(j) == 0:
                return
        lignes += 1
        k = g(je)
        eleves.add(k)
        if jp is not None:
            par_cat.setdefault("(vide)" if _vide(g(jp)) else str(g(jp)), set()).add(k)
    for l in premieres[i_ent + 1:]:
        lire(l)
    for l in it:
        lire(l)
    desc = " ; ".join([f"« {entetes[j]} » {'=' if op == '=' else 'contient'} « {v} »" for j, op, v in conds]
                      + [f"« {entetes[j]} » rempli" for j in nvs]) or "toutes les lignes"
    sortie(f"Conditions : {desc}")
    sortie(f"Élèves différents : {_n(len(eleves))}   (lignes : {_n(lignes)})")
    if jp is not None:
        sortie(f"Par « {entetes[jp]} » (élèves différents) :")
        cats = sorted(par_cat.items(), key=lambda x: -len(x[1]))
        for c, e in cats[:40]:
            sortie(f"  {c} : {_n(len(e))}")
        if len(cats) > 40:
            sortie(f"  … {len(cats) - 40} autres valeurs")
    return {"eleves": len(eleves), "lignes": lignes, "par": {c: len(e) for c, e in par_cat.items()}}


def normalizeText_py(v):
    s = unicodedata.normalize("NFKD", str(v if v is not None else "")).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", s).strip().lower()


def main(argv=None):
    p = argparse.ArgumentParser(description="Charge un gros fichier académique dans Grist par l'API.")
    sp = p.add_subparsers(dest="commande", required=True)
    pi = sp.add_parser("inspecter", help="décrire le fichier, sans rien envoyer")
    pi.add_argument("fichier")
    pi.add_argument("--feuille")
    pi.add_argument("--reglages", default="reglages_bdd.json")
    pi.add_argument("--cle-eleve", help="colonne qui identifie l'élève (sinon devinée)")
    pi.add_argument("--cle-offre", help="colonne qui identifie le vœu possible (formation × établissement), sinon devinée")
    pi.add_argument("--sans-offre", action="store_true", help="pas de table Offre")
    pi.add_argument("--garder-noms", action="store_true", help="garder les colonnes de nom et prénom des élèves")
    pi.add_argument("--ecarter", nargs="+", metavar="COLONNE", help="colonnes à ne pas charger (noms entre guillemets)")
    pi.add_argument("--regrouper", nargs="+", metavar="COLONNE", help="colonnes qui définissent un vœu : les lignes identiques sur ces colonnes n'en font qu'une")
    pi.add_argument("--indicateurs", nargs="+", metavar="COLONNE", help="colonnes « rempli / vide » à charger en Oui / Non")
    pq = sp.add_parser("chiffres", help="nombre d'élèves différents, avec conditions (aucune donnée d'élève affichée)")
    pq.add_argument("fichier")
    pq.add_argument("--par", help="détail par les valeurs d'une colonne")
    pq.add_argument("--si", nargs="+", metavar="CONDITION", help="COLONNE=VALEUR ou COLONNE~TEXTE")
    pq.add_argument("--non-vide", nargs="+", metavar="COLONNE", help="colonnes qui doivent être remplies")
    pq.add_argument("--cle-eleve")
    pq.add_argument("--feuille")
    pr = sp.add_parser("resume", help="statistiques d'un code de décision (sans aucune donnée d'élève)")
    pr.add_argument("fichier")
    pr.add_argument("--colonne", help="colonne du code de décision (sinon devinée)")
    pr.add_argument("--rang", help="colonne du rang du vœu (sinon devinée)")
    pr.add_argument("--cle-eleve", help="colonne de l'identifiant élève (sinon devinée)")
    pr.add_argument("--feuille")
    pc = sp.add_parser("charger", help="envoyer le fichier dans Grist")
    pc.add_argument("fichier")
    pc.add_argument("--reglages", default="reglages_bdd.json")
    pc.add_argument("--essai", type=int, help="envoyer seulement les N premières lignes, dans des tables « …_essai »")
    pc.add_argument("--document", help="ID du document Grist (remplace celui des réglages)")
    a = p.parse_args(argv)
    if not os.path.exists(a.fichier):
        raise SystemExit(f"Fichier introuvable : {a.fichier}")
    if a.commande == "chiffres":
        chiffres(a.fichier, a.par, a.si, a.non_vide, a.cle_eleve, a.feuille)
    elif a.commande == "resume":
        resume_decisions(a.fichier, a.colonne, a.rang, a.cle_eleve, a.feuille)
    elif a.commande == "inspecter":
        inspecter(a.fichier, a.feuille, a.reglages, a.cle_eleve, a.cle_offre, a.sans_offre, a.garder_noms, a.ecarter,
                  a.regrouper, a.indicateurs)
    else:
        try:
            r = charger(a.fichier, a.reglages, a.essai, document=a.document)
        except ConnectionError as e:
            raise SystemExit(f"{e}\nRelancez la même commande : le chargement reprendra où il s'est arrêté.")
        if not r["ok"]:
            sys.exit(2)


if __name__ == "__main__":
    main()
