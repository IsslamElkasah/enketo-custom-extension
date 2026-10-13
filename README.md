# Enketo Toolkit

A browser extension for Enketo forms. Only works on the form page you have open.

It helps you save your data and avoid losing it when a draft gets stuck: you can export a draft as an XML copy, repair a stuck draft, and restore an exported draft onto a fresh form.

## What it does

- **Refresh Parent Data**\*: for dynamic data attachments, clears the cached parent data for the current form and reloads the page, so the form picks up the latest parent data.
- **Saved Drafts**: lists the drafts saved for the current form. Each draft can be renamed or fixed (for stuck submission errors like 401, 409), exported as an XML file, or deleted.
- **Restore from Exported XML**: fills a fresh copy of the form from a previously exported draft. By default, calculated fields are skipped, and you can list extra field names to skip.

\* Kobo's documentation notes a "five-minute delay" in syncing new parent project data with the child project when collecting online ([Dynamic data attachments](https://support.kobotoolbox.org/dynamic_data_attachment.html)). A new parent record may not be available in the child form until then.

## Install

### Chrome, Edge, Brave

1. Download this repository (**Code** > **Download ZIP**) and extract it.
2. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the `chromium-extension` folder.
5. Pin the extension from the puzzle-piece menu so it is always visible.

Keep the folder where it is. The browser loads the extension from it.

### Firefox

1. Download `firefox-extension/enketo-toolkit.xpi` from this repository.
2. Drag the file into a Firefox window, or open `about:addons`, click the gear icon, and choose **Install Add-on From File**.
3. Confirm the install.

## Use

1. Open the Enketo form you want to work on.
2. Click the extension icon.
3. Pick an action: **Refresh Parent Data**, a draft's **Rename / Fix**, **Export** or **Delete**, or **Choose XML File...** to restore an exported draft.

## Update

- **Chrome, Edge, Brave**: download the repository again, replace the contents of your `chromium-extension` folder with the new files, then click the reload icon on the extension's card in the extensions page. Or simply remove the old extension and follow the same steps above.
- **Firefox**: install the new `.xpi` the same way as before.