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

MOTS_CLE = re.compile(r"candidat|eleve|élève|\bine\b|numero|numéro|identifiant|\bid\b|dossier", re.I)


def inspecter(chemin, feuille=None, sortie_reglages="reglages_bdd.json"):
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
    entetes = [str(h).strip() if not _vide(h) else f"Colonne {j + 1}" for j, h in enumerate(premieres[i_ent])]
    nb = len(entetes)
    remplies = [0] * nb
    nombres = [0] * nb
    cles = {j: set() for j, h in enumerate(entetes) if MOTS_CLE.search(h)}
    total = 0

    def compter(l):
        nonlocal total
        if not any(not _vide(v) for v in l):
            return
        total += 1
        for j in range(min(nb, len(l))):
            v = l[j]
            if not _vide(v):
                remplies[j] += 1
                if isinstance(v, (int, float)):
                    nombres[j] += 1
                if j in cles:
                    cles[j].add(v)

    for l in premieres[i_ent + 1:]:
        compter(l)
    debut = time.time()
    for l in it:
        compter(l)
        if total and total % 200000 == 0:
            print(f"  … {total:,} lignes lues ({time.time() - debut:.0f} s)".replace(",", " "))
    print(f"Ligne d'en-têtes : {i_ent + 1}")
    print(f"Lignes de données : {total:,}".replace(",", " "))
    print(f"Colonnes : {nb}  → {total * nb:,} cases".replace(",", " "))
    print("")
    print(f"{'N°':>3}  {'Remplie':>8}  {'Type':<7}  Colonne")
    for j, h in enumerate(entetes):
        taux = (remplies[j] / total * 100) if total else 0
        typ = "nombre" if remplies[j] and nombres[j] >= 0.95 * remplies[j] else "texte"
        print(f"{j + 1:>3}  {taux:>7.1f}%  {typ:<7}  {h}")
    if cles:
        print("")
        print("Colonnes qui peuvent identifier un élève (valeurs différentes) :")
        for j, s in cles.items():
            print(f"  « {entetes[j]} » : {len(s):,} valeurs différentes".replace(",", " "))
        meilleure = max(cles, key=lambda j: len(cles[j]))
        if total and len(cles[meilleure]) < total:
            fois = total / max(1, len(cles[meilleure]))
            print(f"  → « {entetes[meilleure]} » se répète ({fois:.1f} lignes par valeur en moyenne) : "
                  "une ligne par vœu. Deux tables liées (Élèves / Vœux) allégeront Grist.")
    # Fichier de réglages à compléter : aucune valeur, seulement les noms de colonnes
    reglages = {
        "grist": {"serveur": "https://grist.numerique.gouv.fr", "document": "ID_DU_DOCUMENT"},
        "cle_api_fichier": "cle_grist.txt",
        "feuille": feuille,
        "ligne_entete": i_ent + 1,
        "paquet": PAQUET_DEFAUT,
        "tables": {
            "eleves": {
                "nom": "Eleves",
                "cle": entetes[max(cles, key=lambda j: len(cles[j]))] if cles else "",
                "colonnes": {},
            },
            "voeux": {"nom": "Voeux", "colonnes": {h: h for h in entetes}},
        },
        "_aide": ("Recopiez dans « eleves.colonnes » les colonnes qui décrivent l'élève (une valeur par élève) ; "
                  "laissez dans « voeux.colonnes » celles du vœu. Supprimez les colonnes inutiles. "
                  "La valeur de chaque ligne est le nom de la colonne dans Grist (vous pouvez la raccourcir). "
                  "Sans table « eleves » (supprimez-la), tout va dans une seule table."),
    }
    if sortie_reglages:
        if os.path.exists(sortie_reglages):
            print(f"\n{sortie_reglages} existe déjà : il n'est pas remplacé.")
        else:
            with open(sortie_reglages, "w", encoding="utf-8") as f:
                json.dump(reglages, f, ensure_ascii=False, indent=2)
            print(f"\nRéglages à compléter : {sortie_reglages}")
    return {"format": fmt, "lignes": total, "colonnes": entetes, "ligne_entete": i_ent + 1,
            "cles": {entetes[j]: len(s) for j, s in cles.items()}}


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


def charger(chemin, chemin_reglages, essai=None, grist=None, sortie=print):
    dossier = os.path.dirname(os.path.abspath(chemin_reglages))
    with open(chemin_reglages, encoding="utf-8") as f:
        R = json.load(f)
    if grist is None:
        g = R.get("grist") or {}
        if not g.get("document") or g["document"] == "ID_DU_DOCUMENT":
            raise SystemExit("Indiquez l'ID du document Grist dans les réglages (Grist → Paramètres du document → ID du document).")
        grist = Grist(g.get("serveur") or "https://grist.numerique.gouv.fr", g["document"], lire_cle(R, dossier))
    paquet = int(R.get("paquet") or PAQUET_DEFAUT)
    tables_r = R.get("tables") or {}
    te, tv = tables_r.get("eleves"), tables_r.get("voeux")
    if not tv or not tv.get("colonnes"):
        raise SystemExit("Réglages : la table « voeux » (ou table unique) doit lister ses colonnes.")
    separer = bool(te and te.get("cle") and te.get("colonnes"))
    suffixe = "_essai" if essai else ""
    types_forces = R.get("types") or {}

    it = lignes_fichier(chemin, R.get("feuille"))
    i_ent = int(R.get("ligne_entete") or 1) - 1
    for _ in range(i_ent):
        next(it, None)
    entetes = [str(h).strip() for h in (next(it, None) or [])]
    pos = {h: j for j, h in enumerate(entetes)}
    manquantes = [c for t in ([tv] + ([te] if separer else [])) for c in t["colonnes"] if c not in pos]
    if separer and te["cle"] not in pos:
        manquantes.append(te["cle"])
    if manquantes:
        raise SystemExit("Colonnes absentes du fichier : " + ", ".join(f"« {c} »" for c in manquantes))

    # Échantillon (200 lignes) pour deviner les types ; les lignes sont gardées pour l'envoi
    tampon = []
    for l in it:
        tampon.append(l)
        if len(tampon) >= 200:
            break

    def est_nombre(nom):
        vals = [l[pos[nom]] for l in tampon if pos[nom] < len(l) and not _vide(l[pos[nom]])]
        return bool(vals) and all(isinstance(v, (int, float)) for v in vals)

    def plan_table(t, avec_cle):
        pris, cols = set(), []
        if avec_cle:
            cols.append((te["cle"], id_colonne(te["colonnes"].get(te["cle"], te["cle"]), pris), te["colonnes"].get(te["cle"], te["cle"]), "Text"))
        for src, nom in t["colonnes"].items():
            if avec_cle and src == te["cle"]:
                continue
            typ = "Text" if (separer and src == te["cle"]) else _type_colonne(nom, src, types_forces, est_nombre(src))
            cols.append((src, id_colonne(nom, pris), nom, typ))
        return cols

    plans = {"voeux": (id_table(tv.get("nom") or "Voeux") + suffixe, plan_table(tv, separer))}
    if separer:
        plans["eleves"] = (id_table(te.get("nom") or "Eleves") + suffixe, plan_table(te, False))
        if te["cle"] not in te["colonnes"]:
            plans["eleves"][1].insert(0, (te["cle"], id_colonne(te["cle"], set()), te["cle"], "Text"))

    # Reprise : où en était-on ?
    fichier_reprise = os.path.join(dossier, f".reprise_{plans['voeux'][0]}.json")
    reprise = {}
    if os.path.exists(fichier_reprise):
        with open(fichier_reprise, encoding="utf-8") as f:
            reprise = json.load(f)
        if reprise.get("fichier") != os.path.basename(chemin) or reprise.get("taille") != os.path.getsize(chemin):
            raise SystemExit(f"Un chargement d'un autre fichier est en cours ({fichier_reprise}). Supprimez ce fichier pour recommencer.")
        sortie("Un chargement précédent de ce fichier n'est pas terminé : il va être complété.")

    existantes = grist.tables()
    for nom, (tid, cols) in plans.items():
        if tid in existantes:
            n = grist.nombre_lignes(tid)
            if not reprise and n:
                raise SystemExit(f"La table « {tid} » existe déjà dans Grist et contient {n} lignes : pour éviter les doublons, "
                                 "rien n'est envoyé. Choisissez un autre nom de table dans les réglages, ou un autre document.")
        else:
            reel = grist.creer_table(tid, [(c, l, t) for _, c, l, t in cols])
            plans[nom] = (reel, cols)
    tid_v, cols_v = plans["voeux"]
    tid_e, cols_e = plans.get("eleves", (None, []))

    # Ce que Grist contient déjà fait foi (un envoi est tout ou rien) ; à défaut, le fichier de reprise
    deja_v, deja_e = 0, 0
    if reprise:
        n_v0 = grist.nombre_lignes(tid_v)
        n_e0 = grist.nombre_lignes(tid_e) if tid_e else 0
        deja_v = n_v0 if n_v0 is not None else int(reprise.get("voeux", 0))
        deja_e = n_e0 if n_e0 is not None else int(reprise.get("eleves", 0))
        sortie(f"Reprise : {deja_v:,} lignes et {deja_e:,} élèves déjà dans Grist.".replace(",", " "))
    vus = set()
    envoyes_v, envoyes_e = deja_v, deja_e
    lot_v, lot_e = [], []
    lu = 0  # lignes de données lues (non vides)
    debut = time.time()

    def sauver_reprise():
        tmp = fichier_reprise + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"fichier": os.path.basename(chemin), "taille": os.path.getsize(chemin), "voeux": envoyes_v,
                       "eleves": envoyes_e, "version": VERSION}, f)
        os.replace(tmp, fichier_reprise)

    sauver_reprise()

    def envoyer():
        nonlocal lot_v, lot_e, envoyes_e, envoyes_v
        if lot_e:
            grist.ajouter(tid_e, lot_e)
            envoyes_e += len(lot_e)
            lot_e = []
            sauver_reprise()
        if lot_v:
            grist.ajouter(tid_v, lot_v)
            envoyes_v += len(lot_v)
            lot_v = []
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
        if separer:
            cle = _convertir(val(te["cle"]), "Text")
            if cle is not None and cle not in vus:
                rang = len(vus)  # ordre de première apparition : le même à chaque lancement
                vus.add(cle)
                if rang >= deja_e:
                    lot_e.append({c: _convertir(val(src), t) for src, c, _, t in cols_e})
        if lu > deja_v:
            lot_v.append({c: _convertir(val(src), t) for src, c, _, t in cols_v})
        if len(lot_v) >= paquet or len(lot_e) >= paquet:
            envoyer()
            if lu % (paquet * 20) == 0:
                vitesse = (lu - deja_v) / max(1e-6, time.time() - debut)
                sortie(f"  … {lu:,} lignes envoyées ({vitesse:.0f} lignes/s)".replace(",", " "))
    envoyer()

    # Vérification : Grist contient-il tout ?
    sortie("")
    n_v = grist.nombre_lignes(tid_v)
    ok = True
    if n_v is None:
        sortie(f"Vérification impossible (Grist n'a pas donné le nombre de lignes de « {tid_v} ») : contrôlez-le dans Grist : {lu} attendues.")
        ok = False
    elif n_v != lu:
        sortie(f"INCOMPLET : « {tid_v} » contient {n_v} lignes dans Grist, le fichier en a {lu}.")
        ok = False
    else:
        sortie(f"« {tid_v} » : {n_v:,} lignes, identique au fichier.".replace(",", " "))
    if separer:
        n_e = grist.nombre_lignes(tid_e)
        if n_e is None or n_e != len(vus):
            sortie(f"INCOMPLET : « {tid_e} » contient {n_e} lignes dans Grist, {len(vus)} élèves différents dans le fichier.")
            ok = False
        else:
            sortie(f"« {tid_e} » : {n_e:,} élèves, identique au fichier.".replace(",", " "))
    if ok:
        sortie("Chargement complet et vérifié." + (" (essai : tables « …_essai »)" if essai else ""))
        os.remove(fichier_reprise)
    else:
        sortie("Relancez la même commande pour compléter : le chargement reprendra où il s'est arrêté.")
    return {"ok": ok, "lignes": lu, "eleves": len(vus) if separer else None, "tables": [t for t in (tid_v, tid_e) if t],
            "requetes": grist.requetes}


def main(argv=None):
    p = argparse.ArgumentParser(description="Charge un gros fichier académique dans Grist par l'API.")
    sp = p.add_subparsers(dest="commande", required=True)
    pi = sp.add_parser("inspecter", help="décrire le fichier, sans rien envoyer")
    pi.add_argument("fichier")
    pi.add_argument("--feuille")
    pi.add_argument("--reglages", default="reglages_bdd.json")
    pc = sp.add_parser("charger", help="envoyer le fichier dans Grist")
    pc.add_argument("fichier")
    pc.add_argument("--reglages", default="reglages_bdd.json")
    pc.add_argument("--essai", type=int, help="envoyer seulement les N premières lignes, dans des tables « …_essai »")
    a = p.parse_args(argv)
    if not os.path.exists(a.fichier):
        raise SystemExit(f"Fichier introuvable : {a.fichier}")
    if a.commande == "inspecter":
        inspecter(a.fichier, a.feuille, a.reglages)
    else:
        try:
            r = charger(a.fichier, a.reglages, a.essai)
        except ConnectionError as e:
            raise SystemExit(f"{e}\nRelancez la même commande : le chargement reprendra où il s'est arrêté.")
        if not r["ok"]:
            sys.exit(2)


if __name__ == "__main__":
    main()
