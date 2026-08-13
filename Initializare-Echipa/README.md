# Inițializare Echipă Proiect (Teams) — README

Sistem de 3 workflow-uri n8n care creează automat, pornind de la un formular, o echipă completă de proiect pe Microsoft Teams: echipa în sine, toate canalele obligatorii, mesajele inițiale de organizare, membrii din roster-ul standard și tagurile Teams pe funcție.

| # | Workflow | ID | Rol |
|---|---|---|---|
| 1 | **Inițializare Echipă** | `rIoTsRZC49oLjUGU` | Workflow principal — primește formularul, creează echipa, orchestrează celelalte 2 |
| 2 | **Inițializare Echipă - Canale** | `JKSmbresZOAsMqJH` | Creează canalele fixe + suplimentare și postează mesajele inițiale |
| 3 | **Inițializare Echipă - Utilizatori** | `hSM4BGmzwfmMsKYI` | Adaugă responsabilul ca owner, membrii din roster și tagurile pe funcție |

Cele 3 sunt gândite să ruleze împreună: 2 și 3 nu au trigger propriu (sunt de tip *Execute Workflow Trigger*), nu pot fi pornite decât apelate din workflow-ul 1 (sau manual, pentru test).

## Cum se declanșează

Workflow-ul 1 are un nod **Webhook** (`Webhook Formular Echipă`, POST) pe path-ul `initializare-echipa-teams`:

- Production URL: `https://n8n.econfaire.build/webhook/initializare-echipa-teams`
- Test URL: `https://n8n.econfaire.build/webhook-test/initializare-echipa-teams`

Un formular HTML (pagină statică, independentă de n8n) trimite un POST către acest URL cu următoarele câmpuri:

| Câmp | Obligatoriu | Descriere |
|---|---|---|
| `cod_proiect` | da | Cod numeric de proiect, folosit și la începutul numelui echipei |
| `nume_proiect` | da | Devine descrierea echipei Teams |
| `amplasament` | da | Intră în numele echipei |
| `firma` | da | Intră în numele echipei |
| `design_and_build` | nu (implicit „Nu") | „Da" adaugă sufixul `_D&B` în numele echipei |
| `responsabil_email` | da | Emailul persoanei care devine owner al echipei |
| `canale_suplimentare` | nu (implicit gol) | Nume de canale opționale, separate prin virgulă |

**Notă despre conflictul de activare:** dacă la activare n8n spune că path-ul `initializare-echipa-teams` e deja folosit de alt workflow activ, înseamnă că mai există o copie a acestui workflow (importată separat, cu alt ID) activă pe aceeași instanță n8n. Nu poți avea două workflow-uri active cu același path de webhook — trebuie fie dezactivată copia veche, fie schimbat path-ul într-unul dintre ele.

## Fluxul complet, pas cu pas (detaliat, nod cu nod)

### Faza 1 — Workflow 1 „Inițializare Echipă" (orchestratorul)

**1. `Webhook Formular Echipă`** (nod Webhook, `POST`, path `initializare-echipa-teams`, `responseMode: responseNode`)
Primește requestul HTTP trimis de formular. Fiindcă `responseMode` e `responseNode`, workflow-ul **nu răspunde automat** la primirea datelor — răspunsul efectiv se trimite abia la final, din nodul `Confirmare Echipă Creată`, ceea ce înseamnă că cel care a completat formularul așteaptă cu conexiunea deschisă până se termină *tot* procesul (creare echipă + toate canalele + toți membrii), nu doar recepția formularului.

**2. `Normalizează Payload Webhook`** (nod Set)
Preia cele 7 câmpuri din payload și le pune la rădăcina item-ului, cu fallback dublu — încearcă întâi `$json.body?.câmp` (cazul normal, request venit prin webhook, unde datele stau în `body`) și dacă lipsește ia `$json.câmp` (util când workflow-ul e rulat manual/testat direct cu date puse la rădăcină, fără `body`). Câmpul `design_and_build` are fallback suplimentar la `"Nu"` dacă lipsește complet, iar `canale_suplimentare` la `""`.

**3. `Calculează Nume Echipă & Canale`** (nod Set, `includeOtherFields: true` — păstrează și restul câmpurilor din pasul anterior)
Calculează două valori noi:
- `nume_echipa` = concatenare `{cod_proiect}_{firma}` +, doar dacă `design_and_build === "Da"`, sufixul `_D&B`, + `_{amplasament}` la final. Exemplu: cod `1234567`, firmă `ACME`, D&B=Da, amplasament `Cluj` → `1234567_ACME_D&B_Cluj`.
- `canale_suplimentare_array` = dacă `canale_suplimentare` nu e gol, se face `.split(",")`, se face `.trim()` pe fiecare bucată și se elimină bucățile goale (`.filter`); dacă e gol, rezultă `[]`.

**4. `Creează Echipa Teams`** (HTTP Request, `POST https://graph.microsoft.com/v1.0/teams`, credențial `microsoftTeamsOAuth2Api`)
Body JSON: `{"template@odata.bind": ".../teamsTemplates('standard')", "displayName": nume_echipa, "description": nume_proiect}`. Crearea unei echipe prin acest endpoint Graph e **operație asincronă** — Graph răspunde imediat cu `202 Accepted` și fără corp util, dar cu un header `Content-Location` care conține adresa la care poate fi interogat team-ul odată provisionat. Nodul e configurat cu `fullResponse: true` special ca să poată citi acest header în pasul următor.

**5. `Extrage Team ID`** (nod Set)
Din `headers['content-location']` extrage, printr-un regex (`/\('([^']+)'\)/`), GUID-ul echipei nou create și îl salvează ca `team_id`. Tot aici sunt „re-injectate" (citite explicit din nodul `Calculează Nume Echipă & Canale`, nu din inputul curent) valorile `nume_echipa`, `nume_proiect`, `responsabil_email` și `canale_suplimentare_array`, ca să nu se piardă odată ce inputul curent devine răspunsul HTTP de la Graph.

**6. `Așteaptă Provisioning`** (nod Wait, `amount: 30` → 30 de secunde fixe)
Pauză necondiționată — nu verifică efectiv dacă echipa e gata, doar așteaptă un timp fix înainte să continue. Motivul: dacă se încearcă imediat să se citească/creeze canale pe o echipă abia creată, Graph poate încă răspunde cu eroare pentru că provisioning-ul de backend (SharePoint, canal General etc.) nu s-a terminat.

**7. `Obține Canalul General`** (HTTP Request, `GET /teams/{team_id}/primaryChannel`, `executeOnce: true`)
Ia canalul implicit „General" al echipei (fiecare echipă Teams are unul creat automat la înființare). `executeOnce: true` înseamnă că rulează o singură dată chiar dacă ar primi mai multe iteme la input.

**8. `Redenumește Canalul General → Coordonare`** (nod Microsoft Teams, operațiune `update` pe canal, `onError: continueRegularOutput`)
Redenumește canalul General în **„00.SEDINTE COORDONARE"**. Dacă apelul eșuează (ex. throttling Graph, permisiuni), workflow-ul **nu se oprește** — trece mai departe cu output-ul normal, deci echipa ar putea rămâne cu canalul „General" nedenumit dacă acest pas a picat, fără nicio alertă separată.

**9. Ramificare în paralel către cele două sub-workflow-uri**, ambele pornite din output-ul de la pasul 8:
   - **`Apeleaza Workflow Utilizatori`** (Execute Workflow, `waitForSubWorkflow: true`) → rulează integral Workflow 3, cu datele curente (`team_id`, `nume_echipa`, `nume_proiect`, `responsabil_email`, `canale_suplimentare_array`).
   - **`Pregateste Date Canale`** (Set) → reconstruiește setul de date necesar Workflow-ului 2: `team_id`, `nume_echipa`, `canale_suplimentare_array` (toate din `Extrage Team ID`) plus `canal_general_id` (id-ul canalului General, din pasul 7) → **`Apeleaza Workflow Celelalte Canale`** (Execute Workflow, `waitForSubWorkflow: true`) → rulează integral Workflow 2.

   Cele două apeluri rulează **efectiv în paralel** (n8n nu așteaptă unul după altul), fiecare fiind un sub-workflow complet care își face treaba independent pe cele 15-20 de request-uri Graph pe care le conține.

**10. `Așteaptă Finalizare`** (nod Merge, 2 intrări)
Blochează execuția până ambele ramuri (Workflow 3 și Workflow 2) au răspuns — pentru că ambele apeluri au `waitForSubWorkflow: true`, Merge-ul practic doar sincronizează cele 2 rezultate `{status:"ok", mesaj:"..."}` primite înapoi.

**11. `Confirmare Echipă Creată`** (Respond to Webhook, `respondWith: json`)
Abia acum se trimite răspunsul HTTP către formular: `{"status":"ok","mesaj":"Echipa <nume_echipa> a fost creată cu succes! Toate canalele obligatorii și membrii din roster au fost adăugați."}`. Mesajul e afișat identic indiferent dacă vreun pas intermediar (canal, mesaj, tag) a eșuat pe tăcute mai devreme.

### Faza 2 — Workflow 2 „Inițializare Echipă - Canale"

Pornește dintr-un nod **`Primeste Date din Workflow Echipa`** (Execute Workflow Trigger, `inputSource: passthrough` — preia exact datele trimise de Workflow 1, fără să le redefinească). Din acest singur punct pornesc **3 fire în paralel**:

**Firul A — canalele fixe obligatorii**
1. **`Canale Fixe Obligatorii (Lista)`** (Set, `includeOtherFields: true`) — definește direct în cod (hardcodat) un array cu 17 obiecte `{name, tip}`:

   | Canal | Tip |
   |---|---|
   | 0.Urgente | standard |
   | 0.1.Tipizate.Checklists.Proceduri | standard |
   | 1.Birou Arhitectura | standard |
   | 2.Birou Structuri | standard |
   | 3.Birou Instalatii | standard |
   | 4.Compartiment Devize | standard |
   | 6.Compartiment Contracte (privat) | **private** |
   | 9.1 Drumuri | standard |
   | 9.2 Verificari Proiect – DTAC 1 | standard |
   | 9.3 Verificari Proiect – DTAC 2 | standard |
   | 9.4 Verificari Proiect – DTAC 3 | standard |
   | 9.5 Verificari Proiect – DTAC 4_ARH | standard |
   | 9.6 Verificari Proiect – PT.DE 1 | standard |
   | 9.7 Verificari Proiect – PT.DE 2 | standard |
   | 9.8 Verificari Proiect – PT.DE 3 | standard |
   | 9.9 Verificari Proiect – PT.DE 4_ARH | standard |
   | 9.99999 Corespondenta Oficiala (Privat) | **private** |

2. **`Imparte Canale Fixe`** (Split Out pe câmpul `canale_fixe`) — transformă array-ul de mai sus într-un item separat per canal (17 iteme), păstrând restul câmpurilor (`team_id` etc.) pe fiecare.
3. **`Creeaza Canal Fix`** (nod Microsoft Teams, creare canal, `teamId` + `name` + `type` din item, `onError: continueRegularOutput`) — face efectiv `POST` de creare canal pentru fiecare din cele 17, unul câte unul; dacă unul eșuează (ex. nume duplicat, throttling), continuă cu următoarele.
4. Output-ul de la fiecare canal creat merge pe 2 căi:
   - direct la Merge-ul final (intrarea 2 din 4);
   - prin **`Filtreaza Canale Coordonare`** (Filter) — păstrează doar canalele al căror `displayName` e exact unul din: „9.2 Verificari Proiect – DTAC 1", „9.3 ... DTAC 2", „9.4 ... DTAC 3", „9.6 ... PT.DE 1" (deci exact 4 din cele 17, DTAC 4_ARH și PT.DE 2/3/4_ARH **nu** primesc mesaj automat) → **`Text Postare Coordonare`** (Set) — alege textul de postat printr-un obiect-lookup indexat după `displayName` (fiecare canal are propriul text, menționând birourile 1/2/3 și Drumuri, specific fazei DTAC/PT.DE respective) → **`Posteaza Mesaj Coordonare`** (Microsoft Teams, `resource: channelMessage`) — postează mesajul în canalul respectiv → intrarea 1 din 4 a Merge-ului final.

**Firul B — canalele suplimentare**
1. **`Imparte Canale Suplimentare`** (Split Out pe `canale_suplimentare_array`) — un item per nume de canal suplimentar completat în formular (poate fi 0 iteme, dacă formularul nu a avut canale suplimentare).
2. **`Creeaza Canal Suplimentar`** (Microsoft Teams, creare canal `type: standard`, `onError: continueRegularOutput`) — creează fiecare canal suplimentar → intrarea 3 din 4 a Merge-ului final.

**Firul C — mesajele din canalul General/00.SEDINTE COORDONARE**
Rulează secvențial (nu paralel între ele, ca să apară în ordine cronologică corectă în canal), toate pe `canal_general_id` primit de la Workflow 1:
1. **`Posteaza Mesaj Initial`** (Microsoft Teams, `executeOnce: true`, `onError: continueRegularOutput`) — mesajul de bun venit: anunță că echipa `nume_echipa` a fost creată și cere explicit către `@Achiziții` și `@Juridic` să încarce: tema completă de proiectare, cantitățile și oferta financiară de la licitație, personalul cheie și clarificările de la licitație (pe server, în „Tema proiectare-Documente") și contractul (aici, în canalul „6.Compartiment Contracte (privat)"), cu rugămintea de a răspunde (Reply) când sunt încărcate.
2. **`Posteaza Flux Informational`** — al doilea mesaj, cu regulile de organizare a documentelor pe Teams: fișierele se încarcă doar în foldere dedicate pe canalele de specialitate (00.SEDINTE COORDONARE, 1/2/3.Birou..., 9.1 Drumuri), nu „la liber" și nu direct în rădăcina canalului; pozele pot rămâne libere dar recomandat mutate în foldere; discuțiile se poartă prin Reply la postările existente; temele către alte specialități se transmit tot prin Reply, cu link; soluțiile care afectează mai multe obiecte se menționează către toți proiectanții implicați; documentele non-Revit merg în folderul „Colaborare Subcontractanți – Primite și Transmise".
3. **`Posteaza Teme`** — al treilea mesaj, anunțând că transmiterea temelor între specialități se face prin Reply la acest fir, cu trimitere către folderul `07.TEME` din Files → intrarea 4 din 4 a Merge-ului final.

**Sincronizare finală**
**`Asteapta Finalizare Canale`** (Merge, `numberInputs: 4`) așteaptă toate cele 4 fire de mai sus, apoi **`Confirmare Canale Finalizate`** (Code) întoarce `{status:"ok", mesaj:"Canalele fixe si suplimentare au fost create, iar mesajele initiale, de flux, de teme si de coordonare au fost postate."}` către Workflow 1 (care aștepta acest răspuns în nodul „Așteaptă Finalizare").

### Faza 3 — Workflow 3 „Inițializare Echipă - Utilizatori"

Pornește din **`Primeste Date din Workflow Canale`** (Execute Workflow Trigger, passthrough — primește `team_id`, `responsabil_email` și restul câmpurilor trimise de Workflow 1). Se ramifică în 2 fire paralele:

**Firul A — ownerul responsabil de proiect**
**`Adauga Responsabil ca Owner`** (HTTP Request, `POST /teams/{team_id}/members`, `executeOnce: true`, `onError: continueRegularOutput`) — trimite direct `responsabil_email` din formular ca membru cu rol `owner` (`@odata.type: aadUserConversationMember`, `roles:["owner"]`) → intrarea 1 din 2 a Merge-ului final.

**Firul B — roster-ul standard din Excel + taguri**
1. **`Citeste Roster Fix din Excel`** (nod Microsoft Excel, `resource: worksheet`, `operation: readRows`) — citește **toate rândurile** din foaia „Roster" a fișierului `Roster_Echipa_Teams.xlsx`. Fișierul e referit printr-un **ID fix de workbook și de worksheet din OneDrive** (nu printr-o cale/nume căutat dinamic) — același fișier e folosit la fiecare inițializare de echipă, indiferent de proiect.
2. **`Adauga Membru din Roster la Echipa`** (HTTP Request, `POST /teams/{team_id}/members`, `onError: continueRegularOutput`, rulează o dată per rând din Excel) — pentru fiecare rând citit: ia `Email` (sau `email`, indiferent de capitalizare) ca user de adăugat; verifică `Rol` (sau `rol`) — dacă textul conține (case-insensitive) cuvântul „owner", adaugă rolul `["owner"]`, altfel `[]` (membru simplu, fără rol special).
3. **`Filtreaza Randuri cu Tag`** (Filter, condiție **AND**) — trece mai departe doar rândurile la care **ambele** sunt adevărate: (a) coloana `Funcție / Taguri` a rândului Excel curent nu e goală, **și** (b) request-ul de adăugare ca membru de la pasul anterior a întors un `userId` valid (adică persoana chiar a fost adăugată cu succes în echipă). Practic, cine nu are nimic completat pe coloana de taguri, sau cine n-a putut fi adăugat în echipă, nu ajunge deloc la pasul de taguri.
4. **`Proceseaza Taguri`** (Split In Batches — loop, un rând pe iterație) → pentru fiecare rând rămas:
   - **`Cauta Tag Existent`** (HTTP Request, `GET /teams/{team_id}/tags?$filter=displayName eq '<Funcție / Taguri>'`) — caută dacă mai există deja un tag Teams cu exact acel nume (creat la o inițializare anterioară, de exemplu, dacă tagul e comun mai multor proiecte, sau la un rând anterior din același roster).
   - **`Tag Exista?`** (If, `value.length > 0`):
     - **da** → **`Adauga la Tag Existent`** (`POST /teams/{team_id}/tags/{tagId}/members`, body `{"userId": ...}`) — adaugă persoana curentă ca membru suplimentar al tagului deja existent.
     - **nu** → **`Creeaza Tag Nou`** (`POST /teams/{team_id}/tags`, body `{"displayName": "<Funcție / Taguri>", "members": [{"userId": ...}]}`) — creează tagul nou, cu persoana curentă ca prim (și singurul, la acel moment) membru.
   - Ambele ramuri se întorc înapoi în `Proceseaza Taguri`, care trece la următorul rând din listă, până se termină toate → intrarea 2 din 2 a Merge-ului final.

**Sincronizare finală**
**`Asteapta Finalizare Utilizatori`** (Merge, 2 intrări) așteaptă ambele fire, apoi **`Confirmare Utilizatori Adaugati`** (Code) întoarce `{status:"ok", mesaj:"Responsabil adaugat ca owner, membrii din roster adaugati in echipa si tagurile procesate."}` către Workflow 1.

**De reținut:** pasul de taguri e gândit să grupeze automat mai mulți membri (posibil din mai multe echipe/proiecte diferite, dacă fișierul roster e comun) sub același tag Teams, pe bază de funcție — de exemplu toți cei cu „Manager companie" pe coloana de taguri ajung, la finalul mai multor inițializări de echipă, membri ai aceluiași tag „Manager companie" din fiecare echipă în parte (tagurile sunt per-echipă în Teams, nu globale, deci practic se recreează câte o instanță a tagului în fiecare echipă nouă).

## Fișierul Roster_Echipa_Teams.xlsx — structură reală

Foaia **Roster** are astăzi 4 coloane: `Nume`, `Email`, `Rol`, `Funcție / Departament`. Foaia **Instrucțiuni** din același fișier explică cum se completează (email obligatoriu exact ca în Entra/Azure AD, rol `owner`/`member`, nu redenumi foaia sau coloanele).

⚠️ **Inconsistență găsită între Excel și workflow, de rezolvat:** foaia de instrucțiuni spune că a 4-a coloană (`Funcție / Departament`) e „doar informativă, nu e folosită de workflow" — însă Workflow 3 caută explicit o coloană numită **`Funcție / Taguri`** pentru a decide cine primește tag automat. Cum coloana din fișierul actual se numește diferit (`Funcție / Departament`), condiția e mereu goală, iar **automatizarea de taguri nu se declanșează pentru nimeni în starea actuală a fișierului**. Pentru ca funcția de taguri să meargă efectiv, coloana din Excel trebuie redenumită în `Funcție / Taguri` (sau adăugată ca o coloană nouă), păstrând restul structurii neschimbate.

## Cerințe / permisiuni Microsoft Graph

Toate apelurile (creare echipă, canale, mesaje, membri, taguri) folosesc credențialul **Microsoft Teams OAuth2**, atașat pe fiecare nod HTTP Request / Microsoft Teams din cele 3 workflow-uri. Permisiunile Graph necesare, minim:

- Creare echipă: `Team.Create` (via template `standard`)
- Canale: `Channel.Create`, `Channel.ReadBasic.All`
- Mesaje de canal: `ChannelMessage.Send`, `ChannelMessage.Read.All`
- Membri echipă: `TeamMember.ReadWrite.All`
- **Taguri Teams: `TeamworkTag.ReadWrite` (sau `TeamworkTag.Read` + `TeamSettings.ReadWrite.All`) — conform notiței chiar din Workflow 3, această permisiune încă nu este acordată în acest moment.** Fără ea, pasul de căutare/creare taguri va eșua chiar dacă se rezolvă și problema numelui coloanei din Excel.

De asemenea e nevoie de acces la fișierul `Roster_Echipa_Teams.xlsx` din OneDrive (nodul Microsoft Excel din Workflow 3 e legat de un ID fix de workbook + worksheet).

## Limitări cunoscute

- **Timpul fix de 30s** de așteptare după crearea echipei (nodul „Așteaptă Provisioning") e o valoare fixă, nu o verificare reală a stării de provisioning — dacă Microsoft întârzie mai mult, pașii următori (canalul General, canalele, membrii) pot eșua sau întârzia.
- **Redenumirea canalului General** și crearea canalelor/mesajelor au `continueRegularOutput` pe eroare — adică workflow-ul nu se oprește dacă un canal sau un mesaj eșuează, dar nici nu reîncearcă și nici nu semnalează explicit ce anume a eșuat în răspunsul final (mesajul de succes e afișat oricum).
- **Tagurile automate nu funcționează momentan** — atât din cauza numelui de coloană greșit în Excel (`Funcție / Departament` în loc de `Funcție / Taguri`), cât și din cauza permisiunii Graph încă neacordate (`TeamworkTag.ReadWrite`).
- **Lista de canale fixe e hardcodată** direct în workflow (nu vine din configurare externă) — orice modificare de structură (denumiri, tipuri, canale de coordonare) înseamnă editarea codului din nodul „Canale Fixe Obligatorii (Lista)" și, dacă e cazul, a filtrului/textelor de coordonare din „Filtreaza Canale Coordonare" / „Text Postare Coordonare".
- **Mesajele de coordonare** sunt definite doar pentru 4 canale (DTAC 1/2/3, PT.DE 1) — restul canalelor de verificare (DTAC 4_ARH, PT.DE 2/3/4_ARH) nu primesc mesaj automat.
- Cele 2 sub-workflow-uri (Canale, Utilizatori) **nu au trigger propriu** — nu pot fi testate independent decât rulate manual din editor, cu date de test introduse manual (nu au webhook sau schedule).
- Roster-ul e citit dintr-un singur fișier Excel fix din OneDrive, comun tuturor proiectelor — nu există un roster diferit per proiect, doar câmpul `canale_suplimentare` și `responsabil_email` diferă per formular.

## Structura workflow-urilor (rezumat noduri)

**Workflow 1 — Inițializare Echipă**
Webhook Formular Echipă → Normalizează Payload Webhook → Calculează Nume Echipă & Canale → Creează Echipa Teams → Extrage Team ID → Așteaptă Provisioning → Obține Canalul General → Redenumește Canalul General → Coordonare → (Apeleaza Workflow Utilizatori ‖ Pregateste Date Canale → Apeleaza Workflow Celelalte Canale) → Așteaptă Finalizare → Confirmare Echipă Creată.

**Workflow 2 — Inițializare Echipă - Canale**
Primeste Date din Workflow Echipa → (Canale Fixe Obligatorii (Lista) → Imparte Canale Fixe → Creeaza Canal Fix → [Filtreaza Canale Coordonare → Text Postare Coordonare → Posteaza Mesaj Coordonare]) ‖ (Imparte Canale Suplimentare → Creeaza Canal Suplimentar) ‖ (Posteaza Mesaj Initial → Posteaza Flux Informational → Posteaza Teme) → Asteapta Finalizare Canale → Confirmare Canale Finalizate.

**Workflow 3 — Inițializare Echipă - Utilizatori**
Primeste Date din Workflow Canale → (Adauga Responsabil ca Owner) ‖ (Citeste Roster Fix din Excel → Adauga Membru din Roster la Echipa → Filtreaza Randuri cu Tag → Proceseaza Taguri → [Cauta Tag Existent → Tag Exista? → Adauga la Tag Existent / Creeaza Tag Nou]) → Asteapta Finalizare Utilizatori → Confirmare Utilizatori Adaugati.
