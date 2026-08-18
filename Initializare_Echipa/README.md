# Inițializare Echipă Proiect (Teams)

Sistem de 4 workflow-uri n8n care creează automat, pornind de la un formular, o echipă completă de proiect pe Microsoft Teams: echipa în sine, toate canalele obligatorii, structura de foldere din fiecare canal, mesajul inițial de organizare, membrii din roster-ul standard și tagurile Teams pe funcție.

| # | Workflow | Rol |
|---|---|---|
| 1 | **Inițializare Echipă** | Workflow principal — primește formularul, creează echipa, apelează celelalte 3 |
| 2 | **Inițializare Echipă - Canale** | Creează canalele fixe + suplimentare și postează mesajul inițial |
| 3 | **Inițializare Echipă - Foldere** | Creează structura de foldere standard în Files, pe fiecare canal relevant |
| 4 | **Inițializare Echipă - Utilizatori** | Adaugă responsabilul ca owner, membrii din roster și tagurile pe funcție |

Cele 4 sunt gândite să ruleze împreună: 2, 3 și 4 nu au trigger propriu (sunt de tip *Execute Workflow Trigger*). Utilizatori rulează în paralel cu perechea Canale → Foldere (foldere se creează abia după ce canalele există), iar formularul primește răspuns doar după ce ambele ramuri s-au terminat.

## Workflow 1

Inițializare Echipă. Pornește dintr-un webhook apelat de formularul HTML și primește cod proiect, nume proiect, firmă, amplasament, design and build (Da/Nu), responsabil de proiect și eventuale canale suplimentare. Calculează numele echipei, creează echipa pe Teams (Graph, template standard) și așteaptă puțin ca Microsoft să termine provisioning-ul înainte de a continua. Apelează în paralel workflow-ul de Utilizatori și lanțul Canale → Foldere, apoi abia după ce ambele ramuri termină răspunde formularului cu mesaj de succes.

![Echipa](images/Echipa.png)

## Workflow 2

Inițializare Echipă - Canale. Creează cele 18 canale fixe obligatorii ale unui proiect (00.SEDINTE COORDONARE, Urgențe, Tipizate.Checklists.Proceduri, birourile de specialitate — Arhitectură, Structuri, Instalații —, Devize, Contracte (privat), Drumuri, canalele de verificare DTAC 1-4 și PT.DE 1-4, Corespondență Oficială privată, Plan de Situație), plus canalele suplimentare cerute prin formular. Identifică apoi canalul General al echipei și postează în el mesajul de bun venit cu solicitarea de documente către Achiziții/Juridic (tema de proiectare, cantități și ofertă de la licitație, personal cheie, clarificări, contract).

![Canale](images/Canale.png)

## Workflow 3

Inițializare Echipă - Foldere. Așteaptă provizionarea canalelor, apoi ia lista completă de canale ale echipei și, pentru cele relevante (General, 1.Birou Arhitectura, 2.Birou Structuri, 3.Birou Instalatii, 4.Compartiment Devize, 9.1 Drumuri), citește folderul de fișiere asociat fiecărui canal și creează acolo structura standard de subfoldere (organizare, piese scrise, colaborare subcontractanți, teme, avize, studii de teren etc.), respectând ierarhia părinte/copil dintre foldere.

![Foldere](images/Foldere.png)

### Imagine cu folderele create in canalul general (fiecare cu subfoldere proprii):

![FoldereEx](images/FoldereEx.png)

## Workflow 4

Inițializare Echipă - Utilizatori. Adaugă responsabilul de proiect ca owner al echipei, apoi citește lista de membri standard dintr-un fișier Excel (Roster_Echipa_Teams.xlsx, legat de un fișier fix din OneDrive) și îi adaugă pe toți în echipă — owner sau membru simplu, după cum e completat pe coloana „Rol". Pentru fiecare persoană care are completată o funcție pe coloana de taguri, caută dacă există deja un tag Teams cu acel nume; dacă da, o adaugă la tag, dacă nu, creează tagul nou cu persoana ca prim membru.

![Membri](images/Membri.png)

## Structura workflow-urilor (rezumat noduri)

**Workflow 1 — Inițializare Echipă**
Webhook Formular Echipă → Normalizează Payload Webhook → Calculează Nume Echipă & Canale → Creează Echipa Teams → Extrage Team ID → Așteaptă Provisioning → (Apeleaza Workflow Utilizatori ‖ Pregateste Date Canale → Apeleaza Workflow Celelalte Canale → Pregateste Date Foldere → Apeleaza Workflow Foldere) → Așteaptă Finalizare → Confirmare Echipă Creată.

**Workflow 2 — Inițializare Echipă - Canale**
Primeste Date din Workflow Echipa → (Canale Fixe Obligatorii (Lista) → Imparte Canale Fixe → Creeaza Canal Fix) ‖ (Imparte Canale Suplimentare → Creeaza Canal Suplimentar) → Asteapta Finalizare Canale → Listeaza Canale Echipa → Filtreaza Canal General → Posteaza Mesaj Initial → Confirmare Canale Finalizate.

**Workflow 3 — Inițializare Echipă - Foldere**
Primeste Date din Workflow Principal → Asteapta Provizionare Foldere Canale → Obtine Canale Echipa → Construieste Lista Foldere pe Canal → Obtine Folder Fisiere Canal → Pregateste Date Canal Foldere → Imparte Foldere de Creat → Calculeaza Parinte si Nume → Creeaza Folder → Confirmare Foldere Create.

**Workflow 4 — Inițializare Echipă - Utilizatori**
Primeste Date din Workflow Canale → (Adauga Responsabil ca Owner) ‖ (Citeste Roster Fix din Excel → Adauga Membru din Roster la Echipa → Filtreaza Randuri cu Tag → Proceseaza Taguri → [Cauta Tag Existent → Tag Exista? → Adauga la Tag Existent / Creeaza Tag Nou]) → Asteapta Finalizare Utilizatori → Confirmare Utilizatori Adaugati.
