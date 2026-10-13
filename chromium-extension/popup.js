const refreshBtn = document.getElementById('refreshBtn');
const statusDiv = document.getElementById('status');
const draftsList = document.getElementById('draftsList');
const importBtn = document.getElementById('importBtn');
const importFileInput = document.getElementById('importFileInput');
const excludeFieldsInput = document.getElementById('excludeFieldsInput');
const skipCalculatedInput = document.getElementById('skipCalculatedInput');

const ENKETO_DB_NAME = 'enketo';

function getEnketoIdFromLocation() {
  const path = location.pathname;
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const id = trimmed.substring(trimmed.lastIndexOf('/') + 1);
  return id === 'preview' || id === 'i' || id === '' ? null : id;
}

function clearCurrentFormCacheAndReload(dbName) {
  function getEnketoId(path) {
    const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
    const id = trimmed.substring(trimmed.lastIndexOf('/') + 1);
    return id === 'preview' || id === 'i' || id === '' ? null : id;
  }

  const enketoId = getEnketoId(location.pathname);

  if (!enketoId) {
    location.reload();
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open(dbName);

    openReq.onerror = () => reject(openReq.error);

    openReq.onsuccess = () => {
      const db = openReq.result;
      const storeNames = ['surveys', 'resources'].filter((name) =>
        db.objectStoreNames.contains(name)
      );

      if (storeNames.length === 0) {
        db.close();
        resolve();
        return;
      }

      const tx = db.transaction(storeNames, 'readwrite');

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };

      if (storeNames.includes('surveys')) {
        tx.objectStore('surveys').delete(enketoId);
      }

      if (storeNames.includes('resources')) {
        const resourceStore = tx.objectStore('resources');
        const range = IDBKeyRange.bound(
          `${enketoId}:`,
          `${enketoId}:\uffff`
        );
        const cursorReq = resourceStore.openCursor(range);
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
      }
    };
  }).then(() => location.reload());
}

function listDraftsForCurrentForm(dbName) {
  function getEnketoId(path) {
    const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
    const id = trimmed.substring(trimmed.lastIndexOf('/') + 1);
    return id === 'preview' || id === 'i' || id === '' ? null : id;
  }

  const enketoId = getEnketoId(location.pathname);

  if (!enketoId) {
    return Promise.resolve([]);
  }

  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open(dbName);

    openReq.onerror = () => reject(openReq.error);

    openReq.onsuccess = () => {
      const db = openReq.result;

      if (!db.objectStoreNames.contains('records')) {
        db.close();
        resolve([]);
        return;
      }

      const tx = db.transaction('records', 'readonly');
      const store = tx.objectStore('records');
      const index = store.index('enketoId');
      const range = IDBKeyRange.only(enketoId);
      const results = [];

      const cursorReq = index.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const r = cursor.value;
          results.push({
            instanceId: r.instanceId,
            name: r.name,
            updated: r.updated,
          });
          cursor.continue();
        }
      };

      tx.oncomplete = () => {
        db.close();
        results.sort((a, b) => b.updated - a.updated);
        resolve(results);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

function exportDraftAsFile(dbName, instanceId) {
  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open(dbName);

    openReq.onerror = () => reject(openReq.error);

    openReq.onsuccess = () => {
      const db = openReq.result;
      const tx = db.transaction('records', 'readonly');
      const store = tx.objectStore('records');
      const getReq = store.get(instanceId);

      getReq.onsuccess = () => {
        const record = getReq.result;
        db.close();

        if (!record) {
          reject(new Error('Draft not found'));
          return;
        }

        const blob = new Blob([record.xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const safeName = (record.name || record.instanceId || 'draft').replace(
          /[^a-z0-9_\-]+/gi,
          '_'
        );
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeName}.xml`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        resolve();
      };

      getReq.onerror = () => {
        db.close();
        reject(getReq.error);
      };
    };
  });
}

function deleteSingleDraft(dbName, instanceId) {
  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open(dbName);

    openReq.onerror = () => reject(openReq.error);

    openReq.onsuccess = () => {
      const db = openReq.result;
      const storeNames = ['records', 'files'].filter((name) =>
        db.objectStoreNames.contains(name)
      );
      const tx = db.transaction(storeNames, 'readwrite');
      const recordsStore = tx.objectStore('records');

      const getReq = recordsStore.get(instanceId);
      getReq.onsuccess = () => {
        const record = getReq.result;
        recordsStore.delete(instanceId);

        if (record && record.files && storeNames.includes('files')) {
          const filesStore = tx.objectStore('files');
          record.files.forEach((fileKey) => {
            filesStore.delete(`${instanceId}:${fileKey}`);
          });
        }
      };

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

function importXmlIntoForm(xmlString, excludeFieldNames, skipCalculated) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'application/xml');

  if (xmlDoc.querySelector('parsererror')) {
    return { success: false, error: 'The selected file is not valid XML.' };
  }

  const excludeSet = new Set(
    (excludeFieldNames || [])
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean)
  );

  const root = xmlDoc.documentElement;
  const flatValues = [];

  function walk(node, path) {
    const children = Array.from(node.children);
    if (children.length === 0) {
      flatValues.push({ path, value: node.textContent || '' });
      return;
    }
    children.forEach((child) => {
      walk(child, `${path}/${child.tagName}`);
    });
  }

  walk(root, `/${root.tagName}`);

  const valuesByPath = {};
  flatValues.forEach(({ path, value }) => {
    if (!valuesByPath[path]) valuesByPath[path] = [];
    valuesByPath[path].push(value);
  });

  let filledCount = 0;
  const skipped = [];
  const calculatedSkipped = [];

  function fireEvents(el) {
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new CustomEvent('inputupdate', { bubbles: true }));
  }

  Object.keys(valuesByPath).forEach((path) => {
    const segments = path.split('/').filter(Boolean);
    if (segments.includes('meta')) {
      return;
    }

    const leafName = segments[segments.length - 1];
    if (leafName && excludeSet.has(leafName.toLowerCase())) {
      return;
    }

    const values = valuesByPath[path];
    const matches = Array.from(
      document.querySelectorAll(
        `[name="${CSS.escape(path)}"], [data-name="${CSS.escape(path)}"]`
      )
    );

    if (matches.length === 0) {
      skipped.push(path);
      return;
    }

    const first = matches[0];

    if (skipCalculated && first.hasAttribute('data-calculate')) {
      calculatedSkipped.push(path);
      return;
    }

    if (first.type === 'radio') {
      const groupsByRepeat = new Map();
      matches.forEach((el) => {
        const repeatEl = el.closest('.or-repeat') || document;
        if (!groupsByRepeat.has(repeatEl)) groupsByRepeat.set(repeatEl, []);
        groupsByRepeat.get(repeatEl).push(el);
      });
      const repeatGroups = Array.from(groupsByRepeat.values());
      values.forEach((value, i) => {
        const group = repeatGroups[i];
        if (!group) return;
        const target = group.find((el) => el.value === value);
        if (target) {
          target.checked = true;
          fireEvents(target);
          filledCount += 1;
        } else if (value) {
          skipped.push(`${path} (option "${value}" not found)`);
        }
      });
      return;
    }

    if (first.type === 'checkbox') {
      const groupsByRepeat = new Map();
      matches.forEach((el) => {
        const repeatEl = el.closest('.or-repeat') || document;
        if (!groupsByRepeat.has(repeatEl)) groupsByRepeat.set(repeatEl, []);
        groupsByRepeat.get(repeatEl).push(el);
      });
      const repeatGroups = Array.from(groupsByRepeat.values());
      values.forEach((value, i) => {
        const group = repeatGroups[i];
        if (!group) return;
        const tokens = value.split(/\s+/).filter(Boolean);
        let any = false;
        group.forEach((el) => {
          if (tokens.includes(el.value)) {
            el.checked = true;
            fireEvents(el);
            any = true;
          }
        });
        if (any) filledCount += 1;
      });
      return;
    }

    if (first.type === 'file') {
      skipped.push(`${path} (file upload cannot be restored automatically)`);
      return;
    }

    values.forEach((value, i) => {
      const el = matches[i];
      if (!el) return;
      if (!value) return;
      el.value = value;
      fireEvents(el);
      filledCount += 1;
    });
  });

  return { success: true, filled: filledCount, skipped, calculatedSkipped };
}

function renameDraft(dbName, instanceId, newName) {
  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open(dbName);

    openReq.onerror = () => reject(openReq.error);

    openReq.onsuccess = () => {
      const db = openReq.result;
      const tx = db.transaction('records', 'readwrite');
      const store = tx.objectStore('records');
      let notFound = false;

      const getReq = store.get(instanceId);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) {
          notFound = true;
          return;
        }
        record.name = newName;
        record.updated = new Date().getTime();

        const freshInstanceID = 'uuid:' + crypto.randomUUID();
        record.xml = record.xml.replace(
          /<instanceID>[^<]*<\/instanceID>/,
          `<instanceID>${freshInstanceID}</instanceID>`
        );

        store.put(record);
      };

      tx.oncomplete = () => {
        db.close();
        if (notFound) {
          resolve({ success: false, error: 'Draft not found.' });
        } else {
          resolve({ success: true });
        }
      };

      tx.onerror = () => {
        db.close();
        const isConstraint = tx.error && tx.error.name === 'ConstraintError';
        resolve({
          success: false,
          error: isConstraint
            ? 'A draft with that name already exists for this form. Choose a different name.'
            : tx.error
              ? tx.error.message
              : 'Unknown error',
        });
      };
    };
  });
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleString();
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadDrafts() {
  draftsList.innerHTML = '<div id="noDrafts">Loading...</div>';

  try {
    const tab = await getActiveTab();
    const [{ result: drafts }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: listDraftsForCurrentForm,
      args: [ENKETO_DB_NAME],
    });

    renderDrafts(drafts || [], tab.id);
  } catch (err) {
    draftsList.innerHTML = `<div id="noDrafts">Could not load drafts: ${err.message}</div>`;
  }
}

function renderDrafts(drafts, tabId) {
  if (!drafts.length) {
    draftsList.innerHTML = '<div id="noDrafts">No saved drafts for this form.</div>';
    return;
  }

  draftsList.innerHTML = '';

  drafts.forEach((draft) => {
    const row = document.createElement('div');
    row.className = 'draft-row';

    const info = document.createElement('div');
    info.className = 'draft-info';
    info.innerHTML = `<div class="draft-name">${draft.name || '(unnamed)'}</div><div class="draft-date">${formatDate(draft.updated)}</div>`;

    const actions = document.createElement('div');
    actions.className = 'draft-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'rename-btn';
    renameBtn.textContent = 'Rename / Fix';
    renameBtn.addEventListener('click', async () => {
      const newName = prompt(
        'New name for this draft.\n',
        draft.name || ''
      );
      if (newName === null) return;
      const trimmed = newName.trim();
      if (!trimmed) {
        alert('Name cannot be empty.');
        return;
      }

      renameBtn.disabled = true;
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId },
          func: renameDraft,
          args: [ENKETO_DB_NAME, draft.instanceId, trimmed],
        });

        if (!result.success) {
          alert('Rename failed: ' + result.error);
          renameBtn.disabled = false;
        } else {
          await chrome.tabs.reload(tabId);
          window.close();
        }
      } catch (err) {
        alert('Rename failed: ' + err.message);
        renameBtn.disabled = false;
      }
    });

    const exportBtn = document.createElement('button');
    exportBtn.className = 'export-btn';
    exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: exportDraftAsFile,
          args: [ENKETO_DB_NAME, draft.instanceId],
        });
      } catch (err) {
        alert('Export failed: ' + err.message);
      }
      exportBtn.disabled = false;
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      const confirmed = confirm(`Delete draft "${draft.name || draft.instanceId}"? This cannot be undone.`);
      if (!confirmed) return;

      deleteBtn.disabled = true;
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: deleteSingleDraft,
          args: [ENKETO_DB_NAME, draft.instanceId],
        });
        await chrome.tabs.reload(tabId);
        window.close();
      } catch (err) {
        alert('Delete failed: ' + err.message);
        deleteBtn.disabled = false;
      }
    });

    actions.appendChild(renameBtn);
    actions.appendChild(exportBtn);
    actions.appendChild(deleteBtn);
    row.appendChild(info);
    row.appendChild(actions);
    draftsList.appendChild(row);
  });
}

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  statusDiv.textContent = 'Clearing cached data...';

  try {
    const tab = await getActiveTab();
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: clearCurrentFormCacheAndReload,
      args: [ENKETO_DB_NAME],
    });
    statusDiv.textContent = 'Done. Page is reloading...';
    setTimeout(() => window.close(), 1200);
  } catch (err) {
    statusDiv.textContent = 'Error: ' + err.message;
    refreshBtn.disabled = false;
  }
});

importBtn.addEventListener('click', () => {
  importFileInput.click();
});

importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files[0];
  if (!file) return;

  importBtn.disabled = true;
  importBtn.textContent = 'Restoring...';

  try {
    const xmlString = await file.text();
    const excludeFieldNames = (excludeFieldsInput.value || '').split(',');
    const skipCalculated = skipCalculatedInput.checked;
    const tab = await getActiveTab();
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: importXmlIntoForm,
      args: [xmlString, excludeFieldNames, skipCalculated],
    });

    if (!result.success) {
      alert('Restore failed: ' + result.error);
    } else {
      let msg = `Restored ${result.filled} field(s).`;
      if (result.calculatedSkipped && result.calculatedSkipped.length > 0) {
        msg += ` ${result.calculatedSkipped.length} calculated field(s) left as-is.`;
      }
      if (result.skipped.length > 0) {
        msg += ` ${result.skipped.length} field(s) could not be restored.`;
      }
      alert(msg);
    }
  } catch (err) {
    alert('Restore failed: ' + err.message);
  }

  importBtn.disabled = false;
  importBtn.textContent = 'Choose XML File...';
  importFileInput.value = '';
});

loadDrafts();