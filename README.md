# N8N-Automations

Colecție de workflow-uri n8n care automatizează organizarea proiectelor pe Microsoft Teams pentru o companie de proiectare/arhitectură-construcții: de la înființarea echipei unui proiect nou, la postarea mesajelor standard de coordonare, până la monitorizarea automată a mențiunilor fără răspuns. Fiecare automatizare are propriul folder, cu workflow-ul (workflow-urile) n8n exportate, o pagină HTML de sine stătătoare acolo unde e nevoie de o interfață pentru utilizator, și un README specific cu detalii complete.

Acest README oferă o hartă generală a tuturor automatizărilor și tot ce ar avea nevoie cineva ca să le pună în funcțiune de la zero.

## Inventarul automatizărilor

| Folder | Ce face | Declanșator | Interfață |
|---|---|---|---|
| `Initializare_Echipa` | Creează complet o echipă de proiect nouă pe Teams: echipa, canalele, structura de foldere, mesajul de bun venit, membrii din roster și tagurile pe funcție | Webhook, apelat din formular | Pagină HTML (`Initializare-echipa.html`) |
| `Postare_Teams_Template` | Postează pe canalul potrivit al unei echipe unul din 25 de mesaje standardizate de organizare a proiectului, cu mențiuni interactive (canal/membru/persoană externă) | 3 webhook-uri, apelate din formular | Pagină HTML, în 3 pași |
| `Postare_Teams_Coordonare` | Postează dintr-o singură acțiune 10 mesaje predefinite de coordonare/transmitere de teme, câte unul pe canalul specialității lui | Webhook, apelat din formular | Pagină HTML (un singur câmp: codul echipei) |
| `Avertizare_Mentiuni_Teams_Simplu` | Verifică toate canalele echipelor de proiect și trimite reminder dacă o persoană menționată nu a răspuns de un număr fix de zile | Schedule Trigger (din oră în oră) | Fără interfață — rulează automat |
| `Avertizare_Mentiuni_Teams_Complex` | Aceeași idee, dar folosește AI (Claude) ca să înțeleagă mesajul, să decidă dacă chiar are nevoie de răspuns, să detecteze termenul real și urgența, și să rute reminderul în canalul potrivit | Schedule Trigger (din oră în oră, zile lucrătoare) | Fără interfață — rulează automat |
| `Corectare-foldere` | Verifică o arhivă `.zip` a unui folder și corectează denumirile care ar bloca migrarea în Teams/SharePoint/OneDrive, fără să șteargă fișiere | Webhook, apelat din pagina de upload | Pagină HTML (upload/descărcare arhivă) |

## Instanța n8n și adresele webhook

Toate automatizările rulează pe aceeași instanță n8n, la adresa `https://n8n.econfaire.build`. Fiecare pagină HTML apelează direct webhook-ul workflow-ului corespunzător (fetch, fără server intermediar), la adresele:

| Automatizare | Adresă webhook |
|---|---|
| Inițializare Echipă | `/webhook/initializare-echipa-teams` |
| Postare Teams din template | `/webhook/postare-teams/cauta-echipa`, `/webhook/postare-teams/genereaza-mesaj`, `/webhook/postare-teams/trimite` |
| Postare Mesaje Coordonare / Teme | `/webhook/postare-mesaje-echipa` |
| Corectare Foldere | `/webhook/corectare-teams-v1` |

Cele două workflow-uri de avertizare mențiuni nu au webhook — pornesc singure, pe bază de programare (Schedule Trigger).

Dacă instanța n8n se mută pe altă adresă, trebuie actualizată constanta cu adresa de bază din fiecare fișier HTML (`WEBHOOK_URL` sau `BASE`, aproape de începutul tag-ului `<script>`).

## Cerințe tehnice pentru punerea în funcțiune

Este necesară o instanță n8n activă, cu acces de rețea către Microsoft Graph și, pentru avertizarea complexă, către API-ul Anthropic.

**Un cont Microsoft 365 conectat prin OAuth2 în n8n**, ca și credențial de tip *Microsoft Teams OAuth2 API* — folosit de aproape toate workflow-urile pentru apelurile către Microsoft Graph. Contul trebuie să aibă acces la toate echipele de proiect (majoritatea workflow-urilor pornesc de la `GET /me/joinedTeams`, deci contul conectat trebuie să fie el însuși membru — de preferat owner — al fiecărei echipe de proiect). Permisiunile Graph necesare, în funcție de workflow:
- citire echipe/canale: `Team.ReadBasic.All`, `Channel.ReadBasic.All`
- creare echipă și canale: `Team.Create`, `ChannelSettings.ReadWrite.All`
- citire/trimitere mesaje de canal: `ChannelMessage.Read.All`, `ChannelMessage.Send`
- citire/scriere membri echipă: `TeamMember.ReadWrite.All`
- citire/scriere taguri Teams: `TeamworkTag.ReadWrite.All`
- citire/scriere foldere din Files (canale): permisiuni Sites/Files (`Sites.ReadWrite.All` sau echivalent, pentru operațiile pe drive-ul din spatele canalului)

**Un cont Microsoft Outlook conectat prin OAuth2** (*Microsoft Outlook OAuth2 API*), doar pentru `Postare_Teams_Template` — creează evenimentul de calendar la postările de tip ședință. Permisiune necesară: `Calendars.ReadWrite`.

**Un fișier Excel fix, într-un OneDrive/SharePoint accesibil** (`Roster_Echipa_Teams.xlsx`, worksheet „Roster"), cu cel puțin coloanele `Email`, `Rol` (owner/membru) și `Funcție / Taguri` — folosit de `Initializare_Echipa` (workflow-ul „Utilizatori") ca listă standard de membri de adăugat la fiecare echipă nouă. Necesită un credențial *Microsoft Excel OAuth2 API* legat la fișierul respectiv (prin ID fix, nu prin căutare după nume).

**Un cont Anthropic API**, doar pentru `Avertizare_Mentiuni_Teams_Complex` — folosește modelul Claude Sonnet 4.6 prin nodul de tip Langchain (`lmChatAnthropic`). Fiecare mesaj cu mențiune scanat generează un apel către acest model, deci costul crește cu volumul de mențiuni.

**Un Data Table n8n numit `teams_mention_reminders`**, partajat între cele două workflow-uri de avertizare (Simplu și Complex), cu coloanele: `notificationKey`, `teamName`, `channelName`, `mentionedUserName`, `messageId`, `notifiedAt`. Funcționează ca jurnal anti-duplicare, ca să nu se trimită de mai multe ori același reminder.

**O convenție de denumire respectată pentru toate echipele de proiect**: numele echipei Teams trebuie să înceapă cu un cod de exact 7 cifre (ex. `0080825 - Nume Proiect`). Toate workflow-urile care caută sau filtrează echipe (inițializare, postare, avertizare) depind de această convenție — o echipă al cărei nume nu respectă formatul nu va fi găsită.

## Cum se leagă workflow-urile între ele

`Initializare_Echipa` și `Avertizare_Mentiuni_Teams_Complex` sunt fiecare împărțite în mai multe workflow-uri n8n separate, care se apelează între ele prin noduri *Execute Workflow* / *Execute Workflow Trigger* (nu prin webhook) — asta înseamnă că, la import într-o instanță nouă de n8n, referințele dintre ele trebuie relegate manual: se deschide nodul „Apelează Workflow ..." din fiecare și se reselectează workflow-ul țintă din listă, pentru că n8n atribuie ID-uri noi de workflow la fiecare import și cele salvate în fișiere nu mai sunt valide. Restul automatizărilor (`Postare_Teams_Template`, `Postare_Teams_Coordonare`, `Avertizare_Mentiuni_Teams_Simplu`, `Corectare-foldere`) sunt fiecare un singur workflow de sine stătător.