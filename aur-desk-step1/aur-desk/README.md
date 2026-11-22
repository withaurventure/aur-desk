# AUR Desk

Personal app for client onboarding, quotations, invoices and payments across
AUR Ventures, AUR Studio and AUR Printing Studio. Installs on Android from Chrome.
No app store, no build tools.

## Step 1 status
- App shell, offline support and home-screen install
- Company switcher: the whole app recolours for each company
- Home screen (figures show ₹0 until step 2 stores real data)

## Put it online (GitHub Pages, free)
1. On github.com (account withmrshashank), create a new repository named `aur-desk`. Public is fine:
   no prices or client data are in the code. They stay on your phone only.
2. Open the repository, choose **Add file → Upload files**, drag in everything from this folder
   (keep the folders `css`, `js`, `icons`, `logos`), then **Commit changes**.
3. Go to **Settings → Pages**. Under "Build and deployment", pick **Deploy from a branch**,
   branch `main`, folder `/ (root)`, then **Save**.
4. After a minute or two the app is live at `https://withmrshashank.github.io/aur-desk/`.

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
- `js/companies.js`: the three companies, their colours and number prefixes
- `js/app.js`: screens and behaviour
- `sw.js`: offline support
- `manifest.webmanifest`, `icons/`: install name and app icon
