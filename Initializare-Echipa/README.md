## Inițializare Echipă 

1. Creează echipa pe Microsoft Teams (nume calculat: cod_proiect_FIRMA[_D&B]_amplasament).
2. Creează automat toate cele 17 canale obligatorii și redenumește canalul General în "00.SEDINTE COORDONARE"; adaugă și canalele suplimentare opționale din formular.
3. Postează mesajele inițiale standard (indiferent de proiect): bun-venit + solicitare documente de la Achiziții/Juridic, "Management flux informațional", "TEME", și postările de coordonare pe fazele DTAC 1/2/3 și PT.DE 1 — fiecare în canalul lui.
4. Adaugă responsabilul de proiect ca owner al echipei.
5. Citește membrii standard din Roster_Echipa_Teams.xlsx (fișier fix, legat prin ID de workbook/worksheet în OneDrive) și îi adaugă în echipă cu rolul din coloana Rol.
6. Pentru fiecare membru cu "Funcție / Taguri" completat în Excel, îl adaugă automat la tag-ul Teams corespunzător (creează tag-ul dacă nu există).
7. După ce toate ramurile de mai sus s-au terminat (canale + mesaje + owner + roster + taguri), răspunde webhook-ului cu mesaj de succes.
