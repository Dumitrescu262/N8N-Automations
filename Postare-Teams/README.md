## FAZA 1 — Căutare echipă și canale

**Webhook Cauta Echipa** primește codul/numele echipei si o caută pe Microsoft Teams.

- Găsită → obține lista de canale ale echipei și o returnează (**Respond Echipa Gasita**).
- Nu e găsită → returnează eroare (**Respond Echipa Invalid**).
- 
## FAZA 2 — Generare mesaj din template (draft)

**Webhook Genereaza Mesaj** primește tipul de mesaj și datele necesare, determină profilul și compune textul din template.

- Dacă mesajul e legat de o ședință cu dată (**Este sedinta cu data?**) → obține membrii echipei, pregătește programarea, creează evenimentul de calendar (Graph) și adaugă link-ul Teams Meet în text.
- Altfel trece direct la răspuns.

Returnează mesajul ca **DRAFT** (**Respond Draft**) — nu se postează încă pe Teams, doar se pregătește textul (și eventual evenimentul de calendar) pentru revizuire înainte de trimitere.

## FAZA 3 — Trimitere mesaj pe Teams

**Webhook Trimite** primește mesajul confirmat (draft-ul din Faza 2) și canalul țintă.

- Are atașamente (**Are Atasamente?**) → obține folderul canalului, pregătește fișierele binare, le încarcă pe SharePoint/OneDrive-ul canalului și le agregă.
- Fără atașamente → trece direct la pasul următor.

Pregătește payload-ul Graph, postează efectiv mesajul în canal (**Posteaza in Teams**) și returnează confirmarea (**Respond Trimis**).
