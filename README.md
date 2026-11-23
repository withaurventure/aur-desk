# AUR Desk

Personal app for client onboarding, quotations, invoices and payments across
AUR Ventures, AUR Studio and AUR Printing Studio. Installs on Android from Chrome.
No app store, no build tools.

## What works so far
- Step 1: app shell, offline support, home-screen install, company switcher that recolours the app
- Step 2: PIN + fingerprint lock, client onboarding with checklists, Settings (company details,
  payment details you add yourself, rate card editor and import), backup and restore
- Step 3: quotations built from the rate card (validity, 50% / 60% / full payment, ad-spend and GST
  switches, editable terms), branded PDFs shared to WhatsApp or email, approve a quotation to turn it
  into an editable invoice
- Step 4: Money tab to record money in and out by hand (who, which account, method, reference,
  what for), payments linked to invoices update them to Part paid / Paid, receipts as PDFs,
  UPI QR on invoices once a UPI ID is added, real Received / Still due figures on Home
- Swipe a document or a money entry right to send (PDF, receipt or summary), left to edit or delete
  (always asks first; gestures in `js/swipe.js`); Back always returns
  to where you came from
- Calculator: price check from the rate card (with your hourly floor), profit plan against this
  month's Money entries, printing size calculator; price check and printing turn into a quotation in one tap
- Money tab shows all three companies together: total in / out / net for the month, one line per
  company, and a detail view per company (money in by source, expenses by type, all entries)
- Group structure: AUR Ventures is the parent (shared costs, funding, projects, group GSTIN) and is
  not a profit centre; AUR Studio and AUR Printing Studio are the brands. Home shows the group's net
  profit or loss with a drop-down line per company. Rules live in `js/finance.js`
- Premium launch (navy + gold, short animation on fresh opens), compact lock screen with three
  password types (numbers 4–8, letters 6–8, letters + numbers 6–8, case-sensitive) plus
  fingerprint, and a Settings → Privacy & Security page (lock, fingerprint, auto-lock timing,
  backup password). All privacy and security code lives in `js/security/`
- Backup to Google Drive: encrypted on the phone with your backup password (AES-256-GCM), uploaded
  to an "AUR Desk Backups" folder (app can only see its own files), newest 10 kept, one-tap or
  automatic (after every change, hourly, daily, every 2 days, weekly, monthly), restore from Drive

Clients, prices and payment details are stored only on the phone (IndexedDB), plus encrypted
backups in your own Google Drive. They are never part of this repository. The Google Client ID is
pasted into the app's Settings, not stored here. The rate card is imported from a private file that is not kept here.

## Put it online (GitHub Pages, free)
1. On github.com (account withaurventure), create a new repository named `aur-desk`. Public is fine:
   no prices or client data are in the code. They stay on your phone only.
2. Open the repository, choose **Add file → Upload files**, drag in everything from this folder
   (keep the folders `css`, `js`, `icons`, `logos`), then **Commit changes**.
3. Go to **Settings → Pages**. Under "Build and deployment", pick **Deploy from a branch**,
   branch `main`, folder `/ (root)`, then **Save**.
4. After a minute or two the app is live at `https://withaurventure.github.io/aur-desk/`.

## Install on your phone
1. Open that link in **Chrome** on your Android phone.
2. Tap the **⋮ menu → Add to Home screen → Install**.
3. AUR Desk now opens from its own icon, full screen, and works offline.

## Updating later
Upload the changed files to the same repository, and change `VERSION` in `sw.js`
(for example `aur-desk-v2`). The next time you open the app with internet, it updates itself.

## Files
- `index.html`: the page
- `css/app.css`: all styling
- `js/companies.js`: the three companies, colours, number prefixes, starting contact details, onboarding checklists
- `js/app.js`: launch, navigation and the Home screen
- `js/security/`: Privacy & Security folder: `lock.js` (app lock, password types, fingerprint) and `privacy.js` (the Privacy & Security page). Future privacy and security features go here.
- `js/db.js`: on-phone storage
- `js/clients.js`: client list, onboarding form and client page
- `js/settings.js`: company details, rate card, security, backup
- `js/ui.js`: shared helpers and icons
- `js/docs.js`: quotation and invoice numbers, totals and terms
- `js/quote.js`: Documents tab, quotation/invoice editor and document page
- `js/pdf.js`: PDF layout (quotations, invoices, receipts, UPI QR) and sharing
- `js/money.js`: Money tab and the money in / out form
- `js/calc.js`: Calculator (price check, profit, printing size)
- `js/finance.js`: group profit rules (brands, shared costs, funding, internal transfers)
- `js/backup.js`: encrypted backups, Google Drive upload/restore and auto-backup
- `vendor/qrcode.js`: QR code generator (MIT licence, see `vendor/qrcode-LICENSE.txt`)
- `vendor/jspdf.umd.min.js`: PDF engine (jsPDF, MIT licence, see `vendor/jspdf-LICENSE.txt`)
- `fonts/`: Montserrat for PDFs, includes the ₹ sign (SIL Open Font Licence, see `fonts/OFL.txt`)
- `sw.js`: offline support
- `manifest.webmanifest`, `icons/`: install name and app icon
