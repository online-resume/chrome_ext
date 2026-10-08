# AI Resume Builder - Page Clipper

A Chrome extension that reads everything on the page you have open and sends a job posting to
your AI Resume Builder as a role.

## Install

**1. Get the files onto your computer**

1. Open https://github.com/online-resume/chrome_ext in your browser.
2. Click the green **Code** button near the top right of the file list (it is a button, not a
   folder), then click **Download ZIP**.
3. Open your Downloads folder and double-click `chrome_ext-main.zip`. You now have a folder
   called `chrome_ext-main`. Inside it you should see `manifest.json`, `popup.html` and the
   other files listed at the bottom of this page.
4. Move that folder somewhere it can stay (for example Documents). Chrome reads the extension
   from this folder every time it starts, so do not delete it afterwards.

**2. Add it to Chrome**

1. In Chrome's address bar type `chrome://extensions` and press Enter.
2. Switch on **Developer mode** (top right corner of that page).
3. Click **Load unpacked** (top left) and choose the `chrome_ext-main` folder itself, the one
   that has `manifest.json` directly inside it.
4. Click the puzzle-piece icon in Chrome's toolbar and pin **AI Resume Builder - Page Clipper**.

**3. Connect it to the app and sign in**

1. Click the extension's icon and open **Settings** at the bottom. Enter where the app runs:
   - on the computer that runs the app: `http://localhost:8000` (already filled in);
   - on another computer: the app's Tailscale link, the `https://....ts.net` address shown when
     the app starts.
2. Press **Save**. For an address that is not this computer, Chrome asks once for permission to
   reach it: allow it.
3. Enter your AI Resume Builder **username and password** and press **Sign in**.

Everything you send is saved under your own account, and only you see it in the app. Each person
signs in with their own username, on their own Chrome. Your name is shown at the top of the
popup, with **Sign out** next to it. The password is used once to sign in and is not kept; you
stay signed in for 7 days, or until your password changes.

**Updating later:** download the ZIP again, replace the files in the folder, then press the
reload arrow on the extension's card in `chrome://extensions`.

## Use

Open a job page and click the icon. The popup shows what it read, the job title, company and
location (correct them if needed) and the text that will be sent, which you can choose and edit.

- **Send to Resume Builder as a role:** the app matches the text to your best-fitting profile
  and lists it under Email JDs, ready to optimize.
- **Download all page data:** text, headings, links, images, tables, meta tags and the page's
  structured data, as one JSON file. Nothing is sent anywhere.
- **Copy text:** the text box, to the clipboard.

## Job boards with a list beside the job

On Indeed, LinkedIn, Dice, Glassdoor and ZipRecruiter a page shows a list of postings on one
side and the job you clicked on the other. Click the job you want first, then the extension's
icon: only that job is read and sent, not the list or the "other jobs" suggestions, and its
title, company and location are filled in for you. "Text to send" then reads **Only the job
that is open on this page**; the other choices (main part, whole page) are still there.

Indeed has been checked on its live page. If one of the other sites still sends too much,
select the job's text with the mouse before clicking the icon and choose **The text I selected**.

## The apply link

The address behind the page's **Apply** button is sent with the job, and the app shows it on the
role as **Apply**. For it to be found:

- be logged in to the job site (logged out, the button only leads to a sign-in page, and no
  apply link is kept);
- the button must be a link. A button that opens a form on the page (LinkedIn's Easy Apply) has
  no address; the role's own link then takes you to the job.

The popup says whether an apply link was found. Sending the same job again replaces the link
with the current one.

## What it may do

It reads a page only when you click the icon on it, and calls only the app's address. Chrome's
own pages, the Web Store and PDF files cannot be read.

## Files

- `manifest.json` - Manifest V3.
- `extract.js` - runs in the page and returns its data.
- `popup.html`, `popup.css`, `popup.js` - the popup.

No build step. After changing a file, press the reload arrow on the extension's card in
`chrome://extensions`.
