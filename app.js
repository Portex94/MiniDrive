/* ============================================================
   MiniDrive - IndexedDB + Thème + Initialisation
============================================================ */

const DB_NAME = "MiniDriveDB";
const DB_VERSION = 1;
let db = null;
let currentFolderId = 0;
let currentEditableFileId = null;

/* ------------------ IndexedDB ------------------ */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject("Erreur d'ouverture IndexedDB");

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains("files")) {
        const store = database.createObjectStore("files", {
          keyPath: "id",
          autoIncrement: true
        });
        store.createIndex("folderId", "folderId", { unique: false });
      }

      if (!database.objectStoreNames.contains("folders")) {
        database.createObjectStore("folders", {
          keyPath: "id",
          autoIncrement: true
        });
      }

      if (!database.objectStoreNames.contains("settings")) {
        database.createObjectStore("settings", { keyPath: "key" });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };
  });
}

function dbGet(store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbSet(store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(store, index = null, query = null) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const source = index ? tx.objectStore(store).index(index) : tx.objectStore(store);
    const req = source.getAll(query);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ------------------ Thème ------------------ */

async function loadTheme() {
  const saved = await dbGet("settings", "theme");
  const theme = saved ? saved.value : "light";

  document.body.classList.remove("theme-light", "theme-dark");
  document.body.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
}

async function toggleTheme() {
  const isDark = document.body.classList.contains("theme-dark");
  const newTheme = isDark ? "light" : "dark";

  document.body.classList.remove("theme-light", "theme-dark");
  document.body.classList.add(newTheme === "dark" ? "theme-dark" : "theme-light");

  await dbSet("settings", { key: "theme", value: newTheme });
}

/* ------------------ Initialisation ------------------ */

async function initApp() {
  await openDatabase();
  await loadTheme();

  document.getElementById("themeToggle").addEventListener("click", toggleTheme);

  document.getElementById("btnNewUpload").addEventListener("click", () => {
    document.getElementById("fileInput").click();
  });

  document.getElementById("fileInput").addEventListener("change", onFileInputChange);

  document.getElementById("btnNewFolder").addEventListener("click", onNewFolder);
  document.getElementById("btnNewDoc").addEventListener("click", onNewDocument);

  document.getElementById("previewClose").addEventListener("click", closePreview);
  document.getElementById("previewSave").addEventListener("click", saveEditableDocument);

  document.getElementById("btnGenerateReport").addEventListener("click", generateReport);
  document.getElementById("btnGenerateInvoice").addEventListener("click", generateInvoice);

  await loadFolders();
  await loadFiles();
  await updateBreadcrumbs();

  // Service worker (H)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(console.error);
  }

  console.log("MiniDrive prêt ✔️");
}

initApp();

/* ============================================================
   Upload + Affichage fichiers
============================================================ */

async function onFileInputChange(event) {
  const files = event.target.files;
  if (!files.length) return;

  for (const file of files) {
    await dbSet("files", {
      name: file.name,
      type: file.type,
      size: file.size,
      folderId: currentFolderId,
      blob: file,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      editable: false
    });
  }

  event.target.value = "";
  loadFiles();
}

async function loadFiles() {
  const files = await dbGetAll("files", "folderId", currentFolderId);
  renderFileList(files);
}

function renderFileList(files) {
  const container = document.getElementById("fileList");
  container.innerHTML = "";

  if (!files.length) {
    container.innerHTML = `<p style="opacity:0.6; padding:1rem;">Aucun fichier dans ce dossier</p>`;
    return;
  }

  for (const file of files) {
    const row = document.createElement("div");
    row.className = "file-row";

    row.innerHTML = `
      <div class="file-name">
        <div class="file-icon">${file.editable ? "📝" : "📄"}</div>
        <span>${file.name}</span>
      </div>
      <div>${file.type || "—"}</div>
      <div>${new Date(file.updatedAt).toLocaleString()}</div>
      <div>
        <button class="btn secondary btn-open" data-id="${file.id}">Ouvrir</button>
        <button class="btn secondary btn-rename" data-id="${file.id}">Renommer</button>
        <button class="btn secondary btn-move" data-id="${file.id}">Déplacer</button>
        <button class="btn secondary btn-download" data-id="${file.id}">Télécharger</button>
        <button class="btn secondary btn-delete" data-id="${file.id}">Supprimer</button>
      </div>
    `;

    container.appendChild(row);
  }

  attachOpenButtons();
  attachRenameButtons();
  attachMoveButtons();
  attachDownloadButtons();

  document.querySelectorAll(".btn-delete").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      await dbDelete("files", Number(e.target.dataset.id));
      loadFiles();
    });
  });
}

/* ============================================================
   Aperçus + Editeur
============================================================ */

function openModal(title, editable = false) {
  const modal = document.getElementById("previewModal");
  const titleEl = document.getElementById("previewTitle");
  const saveBtn = document.getElementById("previewSave");

  titleEl.textContent = title || "";
  modal.classList.remove("hidden");

  if (editable) saveBtn.classList.remove("hidden");
  else saveBtn.classList.add("hidden");
}

function closePreview() {
  document.getElementById("previewModal").classList.add("hidden");
  document.getElementById("previewContainer").innerHTML = "";
  currentEditableFileId = null;
}

function attachOpenButtons() {
  document.querySelectorAll(".btn-open").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const file = await dbGet("files", Number(e.target.dataset.id));
      openFile(file);
    });
  });
}

function openFile(file) {
  const container = document.getElementById("previewContainer");
  container.innerHTML = "";
  const blob = file.blob;
  const url = URL.createObjectURL(blob);

  if (file.editable && file.type === "text/html") {
    openModal(file.name, true);
    const div = document.createElement("div");
    div.className = "editor-area";
    div.contentEditable = "true";

    const reader = new FileReader();
    reader.onload = () => {
      div.innerHTML = reader.result;
    };
    reader.readAsText(blob);

    container.appendChild(div);
    currentEditableFileId = file.id;
    return;
  }

  openModal(file.name, false);
  container.innerHTML = `<p style="opacity:0.6;">Chargement...</p>`;

  if (file.type.startsWith("image/")) {
    container.innerHTML = `<img src="${url}" style="max-width:100%; height:auto;" />`;
  } else if (file.type === "application/pdf") {
    previewPDF(url);
  } else if (file.type.includes("wordprocessingml")) {
    previewDOCX(blob);
  } else if (file.type === "text/html") {
    const iframe = document.createElement("iframe");
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.src = url;
    container.innerHTML = "";
    container.appendChild(iframe);
  } else {
    container.innerHTML = `<p>Impossible d'afficher ce type de fichier.</p>`;
  }
}

async function previewPDF(url) {
  const container = document.getElementById("previewContainer");
  container.innerHTML = "";

  const pdf = await pdfjsLib.getDocument(url).promise;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.2 });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    container.appendChild(canvas);
  }
}

async function previewDOCX(blob) {
  const container = document.getElementById("previewContainer");
  const arrayBuffer = await blob.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  container.innerHTML = `<div style="font-family:serif;">${result.value}</div>`;
}

/* ------------------ Editeur : sauvegarde ------------------ */

async function saveEditableDocument() {
  if (!currentEditableFileId) return;

  const file = await dbGet("files", currentEditableFileId);
  const editor = document.querySelector(".editor-area");
  const html = editor.innerHTML;

  const blob = new Blob([html], { type: "text/html" });

  file.blob = blob;
  file.updatedAt = Date.now();

  await dbSet("files", file);
  closePreview();
  loadFiles();
}

/* ============================================================
   Dossiers
============================================================ */

async function onNewFolder() {
  const name = prompt("Nom du dossier :");
  if (!name) return;

  await dbSet("folders", {
    name,
    parentId: currentFolderId,
    createdAt: Date.now()
  });

  loadFolders();
}

async function loadFolders() {
  const folders = await dbGetAll("folders");
  const container = document.getElementById("folderList");

  container.innerHTML = "";

  const filtered = folders.filter(f => f.parentId === currentFolderId);

  if (!filtered.length) {
    container.innerHTML = `<li style="opacity:0.6;">Aucun dossier</li>`;
    return;
  }

  for (const folder of filtered) {
    const li = document.createElement("li");
    li.className = "nav-item folder-item";

    li.innerHTML = `
      📁 ${folder.name}
      <span class="folder-actions">
        <button class="btn secondary btn-folder-open" data-id="${folder.id}">Ouvrir</button>
        <button class="btn secondary btn-folder-rename" data-id="${folder.id}">Renommer</button>
        <button class="btn secondary btn-folder-delete" data-id="${folder.id}">X</button>
      </span>
    `;

    li.querySelector(".btn-folder-open").addEventListener("click", () => openFolder(folder.id));
    li.querySelector(".btn-folder-rename").addEventListener("click", () => renameFolder(folder.id));
    li.querySelector(".btn-folder-delete").addEventListener("click", () => deleteFolder(folder.id));

    container.appendChild(li);
  }
}

async function openFolder(id) {
  currentFolderId = id;
  await updateBreadcrumbs();
  await loadFolders();
  await loadFiles();
}

async function updateBreadcrumbs() {
  const bc = document.getElementById("breadcrumbs");

  if (currentFolderId === 0) {
    bc.textContent = "Mon Drive";
    return;
  }

  const path = [];
  let folder = await dbGet("folders", currentFolderId);

  while (folder) {
    path.unshift(folder);
    folder = folder.parentId ? await dbGet("folders", folder.parentId) : null;
  }

  bc.innerHTML = "";

  const root = document.createElement("span");
  root.textContent = "Mon Drive";
  root.className = "breadcrumb-link";
  root.addEventListener("click", () => openFolder(0));
  bc.appendChild(root);

  for (const f of path) {
    bc.innerHTML += " / ";
    const span = document.createElement("span");
    span.textContent = f.name;
    span.className = "breadcrumb-link";
    span.addEventListener("click", () => openFolder(f.id));
    bc.appendChild(span);
  }
}

/* ============================================================
   Renommage / Déplacement
============================================================ */

function attachRenameButtons() {
  document.querySelectorAll(".btn-rename").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const file = await dbGet("files", Number(e.target.dataset.id));
      const newName = prompt("Nouveau nom :", file.name);
      if (!newName) return;

      file.name = newName;
      file.updatedAt = Date.now();
      await dbSet("files", file);
      loadFiles();
    });
  });
}

function attachMoveButtons() {
  document.querySelectorAll(".btn-move").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const file = await dbGet("files", Number(e.target.dataset.id));
      const folders = await dbGetAll("folders");

      if (!folders.length) {
        alert("Aucun dossier disponible.");
        return;
      }

      let list = "Choisissez un dossier :\n";
      folders.forEach(f => list += `${f.id} : ${f.name}\n`);

      const target = Number(prompt(list));
      if (!folders.find(f => f.id === target)) return;

      file.folderId = target;
      file.updatedAt = Date.now();
      await dbSet("files", file);
      loadFiles();
    });
  });
}

async function renameFolder(id) {
  const folder = await dbGet("folders", id);
  const newName = prompt("Nouveau nom du dossier :", folder.name);
  if (!newName) return;

  folder.name = newName;
  await dbSet("folders", folder);
  loadFolders();
  updateBreadcrumbs();
}

async function deleteFolder(id) {
  const files = await dbGetAll("files", "folderId", id);
  const subfolders = (await dbGetAll("folders")).filter(f => f.parentId === id);

  if (files.length || subfolders.length) {
    alert("Le dossier n'est pas vide.");
    return;
  }

  await dbDelete("folders", id);
  loadFolders();
}

/* ============================================================
   Téléchargement
============================================================ */

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  a.remove();
  URL.revokeObjectURL(url);
}

function attachDownloadButtons() {
  document.querySelectorAll(".btn-download").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const file = await dbGet("files", Number(e.target.dataset.id));
      downloadBlob(file.blob, file.name);
    });
  });
}

/* ============================================================
   F : Génération de rapports / factures (HTML)
============================================================ */

async function generateReport() {
  const title = prompt("Titre du rapport :", "Rapport");
  const author = prompt("Auteur :", "");
  const content = prompt("Résumé / contenu :", "");

  const html = `
    <h1>${title}</h1>
    <p><strong>Auteur :</strong> ${author || "—"}</p>
    <p><strong>Date :</strong> ${new Date().toLocaleString()}</p>
    <hr/>
    <p>${content || ""}</p>
  `;

  const blob = new Blob([html], { type: "text/html" });

  await dbSet("files", {
    name: `${title || "rapport"}.html`,
    type: "text/html",
    size: blob.size,
    folderId: currentFolderId,
    blob,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    editable: true
  });

  loadFiles();
}

async function generateInvoice() {
  const client = prompt("Client :", "");
  const amount = prompt("Montant (ex: 1200.00 €) :", "");
  const ref = prompt("Référence facture :", "FAC-" + Date.now());

  const html = `
    <h1>Facture</h1>
    <p><strong>Référence :</strong> ${ref}</p>
    <p><strong>Client :</strong> ${client || "—"}</p>
    <p><strong>Date :</strong> ${new Date().toLocaleDateString()}</p>
    <hr/>
    <p><strong>Montant :</strong> ${amount || "—"}</p>
  `;

  const blob = new Blob([html], { type: "text/html" });

  await dbSet("files", {
    name: `${ref || "facture"}.html`,
    type: "text/html",
    size: blob.size,
    folderId: currentFolderId,
    blob,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    editable: true
  });

  loadFiles();
}

/* ============================================================
   G : Création de documents "type docx" (HTML éditable)
============================================================ */

async function onNewDocument() {
  const name = prompt("Nom du document :", "Nouveau document");
  if (!name) return;

  const html = `<p>Commencez à écrire votre document ici...</p>`;
  const blob = new Blob([html], { type: "text/html" });

  const id = await dbSet("files", {
    name: `${name}.docx.html`,
    type: "text/html",
    size: blob.size,
    folderId: currentFolderId,
    blob,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    editable: true
  });

  const file = await dbGet("files", id);
  openFile(file);
  loadFiles();
}
