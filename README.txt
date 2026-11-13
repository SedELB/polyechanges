POLYECHANGES
============

PROJET ÉTUDIANT NON OFFICIEL. Ce site n'est ni approuvé ni publié par Polytechnique Montréal. Il ne remplace ni la personne coordonnatrice des échanges du département, ni le contrat d'études officiel.


À QUOI SERT LE SITE
-------------------
Aider les étudiantes et étudiants en génie logiciel de Poly à trouver des équivalences probables de cours dans les universités partenaires asiatiques (Chine, Japon, Corée, Taïwan). Le parcours : choisir un pays, choisir ses cours de Poly, voir où ces cours existent, garder jusqu'à 3 universités, copier une ébauche de contrat.

Les niveaux (élevée, moyenne, faible) sont calculés automatiquement, jamais vérifiés par un humain :
  - contenu : le texte du cours d'accueil est comparé aux notions de la grille de chaque cours de Poly ;
  - charge : heures de contact comparées aux heures de Poly (tolérance 15 %), crédits ECTS = 2 x crédits Poly ;
  - élevée = contenu très proche et charge conforme ; moyenne = contenu très proche mais charge non conforme, ou contenu partiel et charge conforme ; faible = contenu partiel et charge non conforme. Sous le seuil « partiel », aucun niveau : le cours n'est pas proposé.
Un cours dont la description n'est pas publiée est comparé sur son titre seul : il ne dépasse jamais « faible ».
Chaque cours d'accueil affiché porte son lien source et sa date de collecte. Seuls les cours en anglais sont proposés.


INSTALLER ET LANCER LE SITE EN LOCAL
------------------------------------
Il faut Node.js 22 (Windows). Pas de Python.
  1. Dans le dossier du projet : npm ci
     (better-sqlite3, la base SQLite, est livré avec son binaire précompilé pour Windows, Linux et macOS : rien à compiler. N'utilisez pas --ignore-scripts : esbuild (construction du site, tsx) et onnxruntime-node (modèle de comparaison) installent leur binaire dans leur script d'installation.)
  2. Lancer le site : npm run dev  (puis ouvrir l'adresse affichée)
  3. Lancer les tests : npm test  (environ 30 secondes ; tourne sans base ni pages enregistrées)
  4. Vérifier les types : npm run typecheck
Le site ne lit que les JSON déjà exportés dans site/public/data. Aucune clé d'API, aucun coût.


CE QUI N'EST PAS VERSIONNÉ, ET POURQUOI
---------------------------------------
  - data/raw/ : copies brutes des pages collectées (preuves des extraits). Volumineux ; se recrée à la collecte.
  - data/polyechanges.sqlite : la base de travail. Se recrée entièrement ; ne jamais la modifier à la main.
  - data/models/ : cache du modèle de comparaison (environ 91 Mo), téléchargé au premier calcul.
  - data/saved/ : pages enregistrées à la main depuis un navigateur (lourdes, protégées par captcha ou file d'attente). À refaire chaque année.
  - data/manual/poly/ : la page du programme de Poly, enregistrée à la main.
Ce qui est versionné : le code, data/sources/ (fiches de sources), data/manual/*.json, data/universities.json, data/criterion/ (versions du critère), data/reports/ (rapports de collecte) et site/public/data (export publié).


PREMIER LANCEMENT SUR UN CLONE NEUF
-----------------------------------
Sans base ni copie brute, tout se recrée depuis les sites des universités (connexion Internet nécessaire).
  1. npm ci
  2. Enregistrer d'abord la page du programme de Poly et les pages à la main (section PAGES À ENREGISTRER À LA MAIN plus bas). Sans la page de Poly, l'export est refusé (aucun cours de Poly à comparer) : le site ne serait qu'une liste vide.
  3. npm run refresh
     (elle prend seule la dernière version gelée du dépôt, v1 : rien à geler sur une base neuve)
  4. npm run dev, et vérifier le site.
Le premier calcul télécharge le modèle (environ 91 Mo) dans data/models/.
Pages manquantes : l'université est « ignorée » (statut distinct de l'échec). Ses cours déjà en base restent tels quels, l'export n'est pas bloqué, et la liste « Pages à réenregistrer depuis un navigateur : ... » apparaît en tête du rapport de collecte, au début et à la fin de npm run refresh.
Une université ignorée qui n'a aucun cours en base (clone neuf) est nommée en tête de ces messages ; le site affiche pour elle « Catalogue non lu cette année » au lieu d'une liste vide. Poly ignoré sans aucun cours en base : l'export est refusé.


PROCÉDURE ANNUELLE
------------------
À faire une fois par année, avant l'ouverture des demandes d'échange.
  1. Réenregistrer les pages à la main (section suivante). Les rapports avertissent quand elles ont plus de 300 jours.
  2. npm run refresh
     Elle enchaîne : partners:check (liste des partenaires sur MoveOn), collect -- all (toutes les universités et Poly), refresh-sources (sources des faits : dates, adresses), compare (version gelée la plus récente du dépôt, celle qui a un FROZEN.json), export (fichiers du site). Elle s'arrête à la première étape en échec.
     Les faits d'université tirés d'une page enregistrée à la main (CityU, SNU, NCKU : hôtes qui bloquent les robots) ne sont jamais retéléchargés par refresh-sources : ils sont vérifiés hors ligne dans leur copie brute (« source enregistrée à la main : vérifiée hors ligne » dans data/reports/AAAA-MM-JJ-sources.txt). Sans copie brute (clone neuf), ils sont listés « à réenregistrer » sans bloquer. Pour qu'un de ces faits suive une page réenregistrée : npm run source:find -- <sha256 de la nouvelle copie> "<extrait>", puis mettre à jour sa source dans data/universities.json.
  3. Lire les rapports dans data/reports/ (un fichier AAAA-MM-JJ-<université>.txt par collecte) : statut, cours ajoutés, retirés, modifiés, avertissements en tête de fichier.
  4. npm run verify-sources  (hors ligne : chaque fait cité est-il toujours retrouvé dans sa copie brute ?)
     Si une position est inexacte : npm run verify-sources -- --fix
  5. npm run dev, vérifier le site, puis le publier (section PUBLIER).
Pour une seule université : npm run collect -- <id> (par exemple ncku-tw), puis npm run compare -- v1 et npm run export -- v1.

Quand un garde-fou bloque la collecte (0 cours lu, perte de plus de 30 % des cours depuis la collecte précédente, plus de 30 % de descriptions vides) :
  1. Lire la raison dans le rapport de l'université. Le plus souvent, un site a changé de forme ou une page enregistrée est incomplète.
  2. Corriger la source ou réenregistrer la page, puis relancer npm run collect -- <id>.
  3. Seulement si la baisse est voulue (un programme réduit, par exemple) : npm run collect -- <id> --accept-loss "<raison en au moins deux mots>". La raison est écrite au rapport.
Jamais de modification de la base à la main : rien n'est exporté tant qu'une collecte a échoué.


PAGES À ENREGISTRER À LA MAIN
-----------------------------
Règles : enregistrer depuis un navigateur normal, « Page Web, complète » (Ctrl+S), ou « Enregistrer au format PDF » (Ctrl+P) quand Ctrl+S ne donne rien ; au moins 5 secondes entre deux pages d'un même site ; ne jamais contourner un captcha, une file d'attente ou une connexion par un script : un humain les passe dans le navigateur, ou la page n'est pas obtenue.
Les chemins attendus sont dans data/sources/<fiche>.json (champ files). Les notes de la cohorte précédente sont dans data/saved/<id>/notes.txt (si le dossier existe).

Poly (indispensable) : data/manual/poly/programme-LOG.html
  Page : https://www.polymtl.ca/programmes/programmes/baccalaureat-en-genie-logiciel (programme de génie logiciel), enregistrée en « Page Web, complète ».

NCKU (Taïwan) : dossier data/saved/ncku-tw/
  Site : https://course.ncku.edu.tw (version anglaise, Advanced Search). Le site demande un captcha : le passer à la main.
  Filtres (d'après les fichiers de la cohorte précédente) : semestre d'automne 2026-2027 (115-1), un département à la fois : informatique (CSIE), génie électrique (EE), mathématiques.
  Fichiers : liste-csie-115-1.html, liste-ee-115-1.html.htm, mathematics.html (les noms doivent correspondre à data/sources/ncku-tw.json).
  Le lecteur garde les cours marqués « Course taught in English » dont l'attribut commence par CSIE, EE ou MATH. Les descriptions viennent d'un second fichier (ncku-tw-syllabus), téléchargé automatiquement.

SNU (Corée) : dossier data/saved/snu-kr/
  Site : https://sugang.snu.ac.kr/sugang/cc/cc100InterfaceSrch.action
  Étapes : bouton ENGLISH du site, Course Search (loupe), Advanced Search ; régler seulement Year (2026), Semester et College, tout le reste à « All » ; bouton Excel (« 엑셀저장 »).
  Quatre exports : snu-eng-2026-fall.xls (College of Engineering, 2nd Semester), snu-sci-2026-fall.xls (College of Natural Sciences, 2nd Semester), snu-eng-2026-spring.xls (Engineering, 1st Semester), snu-sci-2026-spring.xls (Natural Sciences, 1st Semester).
  Conversion en texte (le lecteur lit des .txt) : npm run saved:xls-to-txt -- data/saved/snu-kr/snu-eng-2026-fall.xls (une fois par fichier ; demande Windows et Excel). Sans Excel : ouvrir le .xls dans LibreOffice Calc, « Fichier > Enregistrer sous », type « Texte Unicode (*.txt) », même nom, extension .txt.
  Les descriptions des cours d'informatique viennent du catalogue du département (PDF téléchargé automatiquement, source snu-kr-catalog-cse).

Doshisha (Japon) : dossier data/saved/doshisha-jp/
  Site : https://syllabus.doshisha.ac.jp/ (année 2026). Le site est bilingue japonais et anglais ; utiliser les libellés anglais.
  Une fiche de cours par fichier PDF (Ctrl+P, enregistrer en PDF) : syllabus-<8 chiffres du code>.pdf. Adresse d'une fiche : https://syllabus.doshisha.ac.jp/html/2026/<chiffres 2 à 5 du code>/<code><classe>.html (exemple : .../2026/1691/31691010000.html).
  Les 23 codes actuels sont dans data/sources/doshisha-jp-syllabus.json. Pour en ajouter un : ajouter son adresse dans urls et son fichier dans files, au même rang.
  La liste des cours elle-même vient de data/manual/doshisha-jp.json, construite à la main depuis les listes officielles (voir l'en-tête de pipeline/readers/doshisha-jp.build.ts). Le site de syllabus n'a aucun filtre de langue : le mot-clé (E) n'isole pas les cours en anglais.

CityU (Hong Kong) : dossier data/saved/cityu-hk/
  Navigateur qui n'enregistre qu'en PDF : les fichiers sont des .pdf.
  - cs-echange-liste.pdf : https://www.cs.cityu.edu.hk/en/academic-programmes/student-exchange/exchange-course-list (liste des cours d'échange du département d'informatique ; noter le terme affiché, 202602 la dernière fois).
  - echange-entrants.pdf : https://www.cityu.edu.hk/admo/admissions/exchange-students (page d'admission, sert à sourcer un fait).
  - catalogue-<CODE>.pdf, un par cours : https://www.cityu.edu.hk/catalogue/ug/current/course/<code en minuscules>.htm. Seuls 6 des 14 cours d'informatique ont leur fiche ; pour en ajouter, modifier data/sources/cityu-hk-catalogue.json (urls et files, au même rang).

KAIST (Corée), facultatif :
  Les pages publiques des départements (cs.kaist.ac.kr, ee.kaist.ac.kr) sont téléchargées automatiquement. Le catalogue complet cais.kaist.ac.kr/totalOpeningCourse n'était pas joignable en novembre 2026 (voir data/saved/kaist-kr/notes.txt). Aucune fiche de source ne l'utilise : si le site répond, c'est un ajout (nouvelle fiche dans data/sources/ et nouveau lecteur), pas une obligation.

SJTU (Chine) : rien à enregistrer. Les pages sont téléchargées automatiquement.


LE CRITÈRE (VERSIONS GELÉES)
----------------------------
Le critère est l'ensemble des réglages qui produisent les niveaux : modèle, seuils, tolérance de charge, semaines de session à Poly, grilles de notions. Chaque version vit dans data/criterion/v<N>/ (criterion.json et notions.json). Son journal est data/criterion/CHANGELOG.txt.
  - Une version gelée est immuable : ne jamais modifier ses fichiers. Elle porte data/criterion/v<N>/FROZEN.json (date du gel et hachage de criterion.json et notions.json), versionné avec le code. La comparaison et l'export refusent une version gelée dont le hachage recalculé n'est plus celui de FROZEN.json, même sur une base neuve. L'export refuse aussi des paires calculées avec d'autres réglages que les fichiers actuels (relancer npm run compare).
  - La version actuelle est v1 (modèle all-MiniLM-L6-v2, calibrée sur 120 paires jugées à l'aveugle).
  - Les données changent chaque année, pas le critère : ne créer une nouvelle version que si un réglage doit changer (nouveau modèle, nouveaux seuils, nouvelles grilles de notions pour des cours de Poly).

Créer une nouvelle version :
  1. Copier data/criterion/v1 vers data/criterion/v2, puis modifier criterion.json (champ version, réglages) et notions.json.
  2. Nouveau modèle : ajouter data/criterion/candidates/<slug>.json (modèle épinglé par son hachage de commit), puis npm run calibrate:prepare -- <slug> et npm run calibrate:run -- <slug>.
  3. Tirer des paires à juger : npm run calibrate:sample -- --seed <n> (puis calibrate:sample-2 au besoin).
  4. Jugement à l'aveugle : une personne qui n'a vu ni le code du critère, ni les scores, ni les modèles remplit data/calibration/judgments.json (un niveau et une raison par paire).
  5. npm run calibrate:score -- --chosen <version> --reason "<raison>" écrit data/calibration/report.txt. Choisir, écrire l'entrée de data/criterion/CHANGELOG.txt.
  6. npm run compare -- v2, vérifier les résultats, puis npm run freeze -- v2 (écrit data/criterion/v2/FROZEN.json : à committer).
  7. npm run export -- v2, puis npm run calibrate:clean pour retirer le concours de la base.
Ensuite, npm run refresh utilise la version gelée la plus récente (npm run refresh -- v1 n'est accepté que si v1 est cette version).

POLYECHANGES_MODELS_DIR : variable d'environnement qui place le cache des modèles ailleurs que dans data/models. Utile quand le dossier du projet est synchronisé (OneDrive) et que le modèle est gros (Qwen3-Embedding : environ 2,4 Go). Exemple PowerShell : $env:POLYECHANGES_MODELS_DIR = "C:\Users\<nom>\AppData\Local\polyechanges\models"
npm run test:model lance le test de déterminisme avec le vrai modèle (long, télécharge le modèle) ; il ne tourne pas dans la publication.


PUBLIER
-------
Le fichier .github/workflows/pages.yml publie le site à chaque envoi sur la branche main (ou à la main : onglet Actions, « Publication GitHub Pages », Run workflow). Il lance npm ci, npm test, puis la construction du site avec le bon préfixe d'adresse ; il ne lance ni collecte ni comparaison. Le site publié est donc exactement ce qui est dans site/public/data.
  1. Dans les réglages du dépôt GitHub : Settings > Pages > Source : « GitHub Actions » (une seule fois).
  2. Après une collecte : committer site/public/data et data/reports, puis envoyer sur main.
  3. Adresse du site : https://<compte>.github.io/<nom-du-dépôt>/
Pour tester la construction à la main, depuis PowerShell : $env:BASE_PATH = '/polyechanges/' puis npm run build ; npx vite preview --config site/vite.config.ts sert site/dist. Pas depuis Git Bash : il réécrit /polyechanges/ en C:/Program Files/Git/polyechanges/ et le site construit pointe au mauvais endroit.
