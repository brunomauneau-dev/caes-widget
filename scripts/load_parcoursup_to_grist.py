#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
load_parcoursup_to_grist.py
============================
Télécharge les données Parcoursup nationales depuis data.enseignementsup-recherche.gouv.fr
et les charge dans une table Grist.

Prérequis :
    pip install pandas requests

Utilisation :
    python load_parcoursup_to_grist.py

Configuration (modifier les 4 variables ci-dessous) :
    GRIST_API_KEY   → votre clé API Grist
    GRIST_DOC_ID    → ID du document (dans l'URL après /o/docs/)
    GRIST_TABLE_ID  → nom de la table à créer/écraser dans Grist
    ACADEMIE_FILTRE → "Bordeaux" pour filtrer, None pour tout télécharger (14 000 lignes)
"""

import requests
import pandas as pd
import json
import sys
import time

# ─────────────────────────────────────────
#  CONFIGURATION — à adapter
# ─────────────────────────────────────────
GRIST_API_KEY   = "6bad78bac2d60a8f8c417b5da6441b775040a968"
GRIST_DOC_ID    = "msHoMY5qJm8o"
GRIST_BASE_URL  = "https://grist.numerique.gouv.fr"
GRIST_TABLE_ID  = "Parcoursup_National"   # sera créée si elle n'existe pas

ACADEMIE_FILTRE = "Bordeaux"              # None = toutes les académies (national)
SESSION         = 2025                    # année de session à télécharger

# Colonnes à importer (sous-ensemble lisible ; mettre [] pour tout importer)
COLONNES = [
    "session",
    "g_uai",             # code UAI
    "g_ea_lib_vx",       # établissement
    "dep_lib",           # département
    "acad_mies",         # académie
    "region_etab_aff",   # région
    "fili",              # filière (libellé court)
    "lib_for_voe_ins",   # filière agrégée
    "lib_comp_voe_ins",  # formation détaillée
    "select_form",       # sélectivité (Oui/Non)
    "capa_fin",          # capacité finale
    "voe_tot",           # total voeux
    "voe_tot_f",         # dont filles
    "nb_voe_pp_bg",      # voeux bac général
    "nb_voe_pp_bt",      # voeux bac techno
    "nb_voe_pp_bp",      # voeux bac pro
    "prop_tot",          # propositions totales
    "acc_tot",           # admissions totales
    "acc_tot_f",         # dont filles admises
    "acc_bg",            # admis bac général
    "acc_bt",            # admis bac techno
    "acc_bp",            # admis bac pro
    "pct_f",             # % filles admises
    "pct_bg",            # % bac général admis
    "pct_bt",            # % bac techno admis
    "pct_bp",            # % bac pro admis
    "nb_bours_t",        # boursiers admis
    "pct_bours",         # % boursiers parmi admis
    "rang_der_app_b",    # rang dernier appelé
    "taux_adm",          # taux d'admission
]

# ─────────────────────────────────────────
#  1. TÉLÉCHARGEMENT
# ─────────────────────────────────────────

def telecharger_parcoursup():
    base = "https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets"
    dataset = "fr-esr-parcoursup"

    params = {
        "limit": -1,
        "delimiter": ";",
        "charset": "utf-8",
        "use_labels": "false",
    }

    # Filtre ODS : session ET académie
    filtres = [f"session={SESSION}"]
    if ACADEMIE_FILTRE:
        filtres.append(f'acad_mies="{ACADEMIE_FILTRE}"')
    params["where"] = " AND ".join(filtres)

    # Colonnes spécifiques si demandées
    if COLONNES:
        params["select"] = ",".join(COLONNES)

    url = f"{base}/{dataset}/exports/csv"
    print(f"[1/4] Téléchargement depuis {url}")
    print(f"      Filtre : {params['where']}")

    r = requests.get(url, params=params, timeout=120)
    r.raise_for_status()

    if not r.text.strip():
        print("ERREUR : réponse vide. Vérifiez les paramètres de filtrage.")
        sys.exit(1)

    from io import StringIO
    df = pd.read_csv(StringIO(r.text), sep=";", encoding="utf-8", low_memory=False)
    print(f"      → {len(df)} lignes, {len(df.columns)} colonnes")
    return df


# ─────────────────────────────────────────
#  2. NETTOYAGE
# ─────────────────────────────────────────

def nettoyer(df):
    print("[2/4] Nettoyage des données")

    # Remplacer NaN par None (compatible JSON)
    df = df.where(pd.notnull(df), None)

    # Colonnes numériques : convertir en int quand possible
    cols_int = ["session", "capa_fin", "voe_tot", "voe_tot_f",
                "nb_voe_pp_bg", "nb_voe_pp_bt", "nb_voe_pp_bp",
                "prop_tot", "acc_tot", "acc_tot_f",
                "acc_bg", "acc_bt", "acc_bp",
                "nb_bours_t", "rang_der_app_b"]
    for col in cols_int:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")

    cols_float = ["pct_f", "pct_bg", "pct_bt", "pct_bp", "pct_bours", "taux_adm"]
    for col in cols_float:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    print(f"      → OK ({len(df.columns)} colonnes conservées)")
    return df


# ─────────────────────────────────────────
#  3. GRIST — utilitaires
# ─────────────────────────────────────────

def grist_headers():
    return {
        "Authorization": f"Bearer {GRIST_API_KEY}",
        "Content-Type": "application/json",
    }

def grist_get(path):
    url = f"{GRIST_BASE_URL}/api{path}"
    r = requests.get(url, headers=grist_headers(), timeout=30)
    r.raise_for_status()
    return r.json()

def grist_post(path, payload):
    url = f"{GRIST_BASE_URL}/api{path}"
    r = requests.post(url, headers=grist_headers(),
                      data=json.dumps(payload), timeout=60)
    r.raise_for_status()
    return r.json()


# ─────────────────────────────────────────
#  4. CHARGEMENT DANS GRIST
# ─────────────────────────────────────────

def grist_type(series):
    """Déduit le type Grist depuis le dtype pandas."""
    dtype = str(series.dtype)
    if "Int" in dtype or dtype == "int64":
        return "Int"
    if "float" in dtype:
        return "Numeric"
    return "Text"

def creer_ou_vider_table(df):
    """Crée la table si elle n'existe pas, ou vide son contenu."""
    tables = grist_get(f"/docs/{GRIST_DOC_ID}/tables")
    ids_existants = [t["id"] for t in tables.get("tables", [])]

    if GRIST_TABLE_ID in ids_existants:
        print(f"      Table '{GRIST_TABLE_ID}' existante → vidage...")
        rows = grist_get(f"/docs/{GRIST_DOC_ID}/tables/{GRIST_TABLE_ID}/data")
        row_ids = rows.get("id", [])
        if row_ids:
            grist_post(
                f"/docs/{GRIST_DOC_ID}/tables/{GRIST_TABLE_ID}/data/delete",
                row_ids
            )
        print(f"      → {len(row_ids)} lignes supprimées")
    else:
        print(f"      Table '{GRIST_TABLE_ID}' absente → création...")
        colonnes_def = [
            {"id": col, "fields": {"label": col, "type": grist_type(df[col])}}
            for col in df.columns
        ]
        grist_post(f"/docs/{GRIST_DOC_ID}/tables", {
            "tables": [{"id": GRIST_TABLE_ID, "columns": colonnes_def}]
        })
        print(f"      → Table créée avec {len(colonnes_def)} colonnes")


def charger_par_lots(df, taille_lot=500):
    """Envoie les données en lots de taille_lot lignes."""
    total = len(df)
    chargees = 0

    for debut in range(0, total, taille_lot):
        lot = df.iloc[debut:debut + taille_lot]

        records = []
        for _, row in lot.iterrows():
            fields = {}
            for col in df.columns:
                val = row[col]
                # Convertir les types pandas non-sérialisables
                try:
                    if pd.isna(val):
                        val = None
                except Exception:
                    pass
                if hasattr(val, "item"):  # numpy scalar
                    val = val.item()
                fields[col] = val
            records.append({"fields": fields})

        grist_post(
            f"/docs/{GRIST_DOC_ID}/tables/{GRIST_TABLE_ID}/records",
            {"records": records}
        )
        chargees += len(lot)
        print(f"      {chargees}/{total} lignes chargées...", end="\r")
        time.sleep(0.1)  # éviter le rate-limiting

    print(f"      → {total} lignes chargées            ")


def charger_dans_grist(df):
    print(f"[3/4] Connexion Grist ({GRIST_BASE_URL})")
    try:
        profil = grist_get("/profile/user")
        print(f"      Connecté en tant que : {profil.get('email', '?')}")
    except Exception as e:
        print(f"ERREUR connexion Grist : {e}")
        sys.exit(1)

    print(f"[4/4] Chargement dans '{GRIST_TABLE_ID}'")
    creer_ou_vider_table(df)
    charger_par_lots(df)


# ─────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 55)
    print("  Parcoursup → Grist loader")
    print(f"  Session {SESSION} | Académie : {ACADEMIE_FILTRE or 'toutes'}")
    print("=" * 55)

    df = telecharger_parcoursup()
    df = nettoyer(df)

    print("\nAperçu des 3 premières lignes :")
    print(df.head(3).to_string())
    print()

    rep = input("Continuer le chargement dans Grist ? [o/N] : ").strip().lower()
    if rep != "o":
        print("Annulé.")
        sys.exit(0)

    charger_dans_grist(df)

    print("\n✓ Terminé.")
    print(f"  Ouvrir : {GRIST_BASE_URL}/o/docs/{GRIST_DOC_ID}/")
