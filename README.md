# AI Resume Builder - Page Clipper

A Chrome extension that reads everything on the page you have open and sends a job posting to
your AI Resume Builder as a role.

## Install

1. Download this folder (Code -> Download ZIP, then unzip; or `git clone`).
2. In Chrome open `chrome://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and choose the folder.
4. Log in to AI Resume Builder in the same Chrome. The extension uses that login and never sees
   your password.
5. Click the extension's icon, open **Settings**, and enter where the app runs (default
   `http://localhost:8000`; from another computer, the app's Tailscale link). Chrome asks once
   for permission to reach an address that is not this computer.

## Use

Open a job page and click the icon. The popup shows what it read, the job title, company and
location (correct them if needed) and the text that will be sent, which you can choose and edit.

- **Send to Resume Builder as a role:** the app matches the text to your best-fitting profile
  and lists it under Email JDs, ready to optimize.
- **Download all page data:** text, headings, links, images, tables, meta tags and the page's
  structured data, as one JSON file. Nothing is sent anywhere.
- **Copy text:** the text box, to the clipboard.

## What it may do

It reads a page only when you click the icon on it, and calls only the app's address. Chrome's
own pages, the Web Store and PDF files cannot be read.

## Files

- `manifest.json` - Manifest V3.
- `extract.js` - runs in the page and returns its data.
- `popup.html`, `popup.css`, `popup.js` - the popup.

No build step. After changing a file, press the reload arrow on the extension's card in
`chrome://extensions`.
