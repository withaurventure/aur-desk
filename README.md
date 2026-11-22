# AUR Desk

Personal app for client onboarding, quotations, invoices and payments across
AUR Ventures, AUR Studio and AUR Printing Studio. Installs on Android from Chrome.
No app store, no build tools.

## What works so far
- Step 1: app shell, offline support, home-screen install, company switcher that recolours the app
- Step 2: PIN + fingerprint lock, client onboarding with checklists, Settings (company details,
  payment details you add yourself, rate card editor and import), backup and restore

Clients, prices and payment details are stored only on the phone (IndexedDB). They are never
part of this repository. The rate card is imported from a private file that is not kept here.

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
- `js/app.js`: lock, navigation and the Home screen
- `js/lock.js`: PIN and fingerprint lock
- `js/db.js`: on-phone storage
- `js/clients.js`: client list, onboarding form and client page
- `js/settings.js`: company details, rate card, security, backup
- `js/ui.js`: shared helpers and icons
- `sw.js`: offline support
- `manifest.webmanifest`, `icons/`: install name and app icon
