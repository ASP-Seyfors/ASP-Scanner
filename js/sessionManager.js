/* =======================================================================
 * Allied Surgical Products - Inventory Management System
 * File: js/sessionManager.js
 * Author: Thomas Seyfors
 * Date Created: August 2026
 * 
 * Description:
 *   Session lifecycle orchestrator. Handles workflow state management, 
 *   real-time scanning memory storage, Pre-Load Manifest verification, 
 *   and API payloads to Google Apps Script.
 *
 * Affected Features:
 *   - Pre-Load Manifests & Discrepancy Trackers
 *   - QBO Feeder Integration
 *   - Cloud Archiving & Payload Auto-Splitting
 *   - Local Device History & Offloading
 *   - Sandbox / Production API Routing
 *
 * Copyright (c) 2026 Thomas Seyfors / Allied Surgical Products.
 * All Rights Reserved.
 * ======================================================================= */
const SessionManager = {
  scannedObjects: JSON.parse(localStorage.getItem('asp_session_scanned_objects')) || [],
  pendingNewItems: JSON.parse(localStorage.getItem('asp_pending_new_items')) || [],
  pendingUpdates: {},
  pendingFieldUpdates: JSON.parse(localStorage.getItem('asp_pending_updates')) || [],
  isManifestEnabled: false,
  expectedManifest: JSON.parse(localStorage.getItem('asp_active_manifest')) || [],
  
  currentItemAction: "Inventory",
  isSessionActive: false,
  currentUserName: localStorage.getItem('asp_user_name') || "",
  currentSessionName: localStorage.getItem('asp_session_name') || "",
  currentOrderNum: localStorage.getItem('asp_order_num') || "",
  currentWorkflowType: localStorage.getItem('asp_workflow_type') || "Receiving",
  sessionStartStr: localStorage.getItem('asp_session_start_str') || "",
  sessionDateStr: localStorage.getItem('asp_session_date_str') || "",
  currentMatchedItem: null,

  sessionId: localStorage.getItem('asp_session_id') || "",

  currentArchiveTab: 'local',

  fetchedStagedData: {},

  // Cloud URLs
  cloudArchiveUrl: "https://script.google.com/macros/s/AKfycbzJw6P78vbvpYVOAqBqkAJezLpk1SXxwF1ndSs3my6ZeF3pJh1tBHvyGwWcuYsB63uG/exec",
  googleFeederUrl: "https://script.google.com/macros/s/AKfycbxccIizG_pkX6ARslZCv4ElewSCRz_HUtsn0R8CKpCAFgVKPj972RLrL5eUsTNArq6IeA/exec",

  // Sandbox URLs
  testArchiveUrl: "https://script.google.com/macros/s/AKfycbwHNk0QL0Cu1bInJxjDqGxvQ-RdPD8xJaPVV3OpTdAOVJZBhppqieVj7AKS_j2B5QpuBQ/exec", 
  testFeederUrl: "https://script.google.com/macros/s/AKfycbyugIbNY6XYvume81EmEklb32uFxuesGE9et3XrImUjYtHjkbKR6Q6goIHABAZ0P0BQfg/exec", 

  getActiveArchiveUrl() {
    let chk = document.getElementById('chkSandboxMode');
    return (chk && chk.checked) ? this.testArchiveUrl : this.cloudArchiveUrl;
  },
  
  getActiveFeederUrl() {
    let chk = document.getElementById('chkSandboxMode');
    return (chk && chk.checked) ? (this.testFeederUrl || this.googleFeederUrl) : this.googleFeederUrl;
  },

  applyTestingModeVisuals(isTestActive) {
    if (isTestActive) {
      document.body.style.backgroundColor = '#fff3e0'; // Warm orange
      document.querySelectorAll('.card').forEach(card => {
        card.style.borderColor = '#ff9800';
        card.style.backgroundColor = '#e1f5fe'; // Light blue
      });
    } else {
      document.body.style.backgroundColor = '';
      document.querySelectorAll('.card').forEach(card => {
        card.style.borderColor = '';
        card.style.backgroundColor = '';
      });
    }
  },

  async pushToCloudArchive(sessionObj) {
    if (!this.getActiveArchiveUrl()) return; 
    
    let chunks = this.splitPayloadIfNeeded(sessionObj);
    
    for (let chunk of chunks) {
      let payload = {
        action: "ARCHIVE_SESSION",
        payload: chunk
      };

      try {
        await fetch(this.getActiveArchiveUrl(), {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });
      } catch(err) {
        console.warn("Background Cloud Archive push failed for chunk:", err);
      }
    }
  },

  splitPayloadIfNeeded(sessionObj) {
    const MAX_CHARS = 45000;
    let fullString = JSON.stringify(sessionObj);
    if (fullString.length <= MAX_CHARS) {
      return [sessionObj];
    }

    // Group scans by REF to prevent mathematical zero-outs during Event Replay
    let scansByRef = {};
    sessionObj.scannedObjects.forEach(scan => {
      let ref = scan.ref || 'UNKNOWN';
      if (!scansByRef[ref]) scansByRef[ref] = [];
      scansByRef[ref].push(scan);
    });

    let chunks = [];
    let currentScans = [];
    let baseSession = { ...sessionObj, scannedObjects: [] };
    let currentSize = JSON.stringify(baseSession).length + 50;

    for (let ref in scansByRef) {
      let refScans = scansByRef[ref];
      let refStrLen = JSON.stringify(refScans).length;
      
      if (currentSize + refStrLen > MAX_CHARS && currentScans.length > 0) {
        chunks.push(currentScans);
        currentScans = [];
        currentSize = JSON.stringify(baseSession).length + 50;
      }
      currentScans.push(...refScans);
      currentSize += refStrLen + 1;
    }
    if (currentScans.length > 0) chunks.push(currentScans);

    let splitSessions = [];
    let baseId = parseInt(sessionObj.id, 10);
    if (isNaN(baseId)) baseId = Date.now();

    for (let i = 0; i < chunks.length; i++) {
      let newSess = JSON.parse(JSON.stringify(baseSession));
      newSess.scannedObjects = chunks[i];
      newSess.sessionName = `${sessionObj.sessionName} (Part ${i + 1} of ${chunks.length})`;
      newSess.id = String(baseId + i);
      
      // CRITICAL: Prevent subsequent parts from wiping the database during Event Replay
      if (i > 0 && newSess.workflowType === 'Full Stocktake') {
        newSess.workflowType = 'Selection Stocktake';
      }
      
      splitSessions.push(newSess);
    }
    
    return splitSessions;
  },

  switchArchiveTab(tabName) {
    this.currentArchiveTab = tabName;
    let btnLocal = document.getElementById('tabLocalArchive');
    let btnCloud = document.getElementById('tabCloudArchive');
    
    if (tabName === 'local') {
      btnLocal.style.backgroundColor = '#0277bd'; btnLocal.style.color = '#fff'; btnLocal.style.border = '1px solid #0277bd';
      btnCloud.style.backgroundColor = '#f5f5f5'; btnCloud.style.color = '#555'; btnCloud.style.border = '1px solid #ccc';
    } else {
      btnCloud.style.backgroundColor = '#0277bd'; btnCloud.style.color = '#fff'; btnCloud.style.border = '1px solid #0277bd';
      btnLocal.style.backgroundColor = '#f5f5f5'; btnLocal.style.color = '#555'; btnLocal.style.border = '1px solid #ccc';
      
      let dir = JSON.parse(localStorage.getItem('asp_cloud_directory')) || [];
      if (dir.length === 0) this.syncCloudArchive();
    }
    this.renderArchiveList();
  },

  async syncAllocationsToCloud() {
    // ✨ CIRCUIT BREAKER ADDITION: Abort upload if we cannot verify we have the full picture
    if (sessionStorage.getItem('asp_allocations_verified') !== 'true') {
        console.warn("ABORTED: Cannot upload allocations because the local cache was not successfully verified with the cloud.");
        return;
    }

    let rawAllocations = localStorage.getItem('asp_allocations') || '{}';
    let allocationsObj = JSON.parse(rawAllocations);
    
    let payload = {
      action: "SYNC_ALLOCATIONS",
      allocations: allocationsObj
    };

    try {
      await fetch(this.getActiveArchiveUrl(), {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.warn("Background allocation sync failed:", err);
    }
  },

  async fetchAllocationsFromCloud() {
    try {
      let res = await fetch(`${this.getActiveArchiveUrl()}?action=GET_ALLOCATIONS`);
      let data = await res.json();
      if (data.status === "success" && data.allocations) {
        let allocMap = {};
        data.allocations.forEach(a => {
          if (!allocMap[a.customerName]) allocMap[a.customerName] = {};
          
          // Rebuild the object structure
          if (!allocMap[a.customerName][a.ref]) {
              allocMap[a.customerName][a.ref] = { qty: 0, details: [] };
          }
          
          // Strip timezone/timestamp garbage injected by Google Sheets
          let cleanExp = a.exp || 'NO_EXP';
          if (typeof cleanExp === 'string' && cleanExp.includes('T')) {
              cleanExp = cleanExp.split('T')[0];
          }
          
          // Parse string quantities into integers before adding
          let safeQty = parseInt(a.qty, 10) || 0;
          
          allocMap[a.customerName][a.ref].qty += safeQty;
          allocMap[a.customerName][a.ref].details.push({
             lot: a.lot, 
             exp: cleanExp, 
             qty: safeQty, 
             orderNum: a.orderNum, 
             sessionId: a.sessionId
          });
        });
        localStorage.setItem('asp_allocations', JSON.stringify(allocMap));
        
        // ✨ CIRCUIT BREAKER ADDITION: Mark successful download
        sessionStorage.setItem('asp_allocations_verified', 'true');
      } else {
        throw new Error("Invalid payload received from cloud.");
      }
    } catch (err) {
      console.warn("Failed to fetch cloud allocations:", err);
      // ✨ CIRCUIT BREAKER ADDITION: Revoke upload permission if download fails
      sessionStorage.removeItem('asp_allocations_verified');
    }
  },

  async syncCloudArchive(event, silent = false) {
    const btn = event ? event.target : null;
    const originalText = btn ? btn.textContent : "☁️ Sync Directory";
    if (btn) { btn.textContent = "⏳ Syncing..."; btn.disabled = true; btn.style.opacity = "0.7"; }

    try {
      let res = await fetch(`${this.getActiveArchiveUrl()}?action=SYNC_DIRECTORY&t=${Date.now()}`);
      let text = await res.text();
      
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        throw new Error("Cloud Vault returned an HTML error page. Check your Apps Script deployment permissions.");
      }
      
      if (data.status === "success" && data.archive) {
        localStorage.setItem('asp_cloud_directory', JSON.stringify(data.archive));

        if (data.db && typeof DatabaseManager !== 'undefined') {
          DatabaseManager.importCloudDatabase(data.db);
        }
        
        await this.fetchAllocationsFromCloud();

        if (this.currentArchiveTab === 'cloud') this.renderArchiveList();
        if (!silent) alert(`Cloud Directory Synced! Found ${data.archive.length} total sessions in the vault.`);
      } else {
        alert("Sync failed: " + (data.message || "Unknown error"));
      }
    } catch (err) {
      if (!silent) alert("Error connecting to Cloud Vault: " + err.message);
      else console.warn("Cloud Vault sync warning:", err.message);
    } finally {
      if (btn) { btn.textContent = originalText; btn.disabled = false; btn.style.opacity = "1"; }
    }
  },

  async pushLegacySessionsToCloud(event, silent = false) {
    const btn = event ? event.target : null;
    const originalText = btn ? btn.textContent : "⬆️ Upload Local History";
    if (btn) { btn.textContent = "⏳ Uploading..."; btn.disabled = true; btn.style.opacity = "0.7"; }

    let archive = JSON.parse(localStorage.getItem('asp_session_archive')) || [];
    let completedSessions = archive.filter(s => s.status === 'Completed' && !s.isSynced);

    if (completedSessions.length === 0) {
      localStorage.setItem('asp_pending_new_items', JSON.stringify([]));
      localStorage.setItem('asp_pending_updates', JSON.stringify([]));
      if (!silent) alert("All completed sessions are already synchronized with the Cloud Archive.");
      if (btn) { btn.textContent = originalText; btn.disabled = false; btn.style.opacity = "1"; }
      return;
    }

    let successCount = 0;
    for (let session of completedSessions) {
      try {
        let chunks = this.splitPayloadIfNeeded(session);
        for (let chunk of chunks) {
            let payload = { action: "ARCHIVE_SESSION", payload: chunk };
            await fetch(this.getActiveArchiveUrl(), {
              method: 'POST',
              mode: 'no-cors',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify(payload)
            });
        }
        session.isSynced = true;
        successCount++;
      } catch (err) {
        console.warn(`Failed to push session: ${session.sessionName}`, err);
      }
    }

    localStorage.setItem('asp_session_archive', JSON.stringify(archive));
    localStorage.setItem('asp_pending_new_items', JSON.stringify([]));
    localStorage.setItem('asp_pending_updates', JSON.stringify([]));

    if (!silent) alert(`Successfully pushed ${successCount} session(s) to the Cloud Archive!`);
    if (btn) { btn.textContent = originalText; btn.disabled = false; btn.style.opacity = "1"; }
  },

  async offloadAndPurgeHistory(event) {
    const btn = event ? event.target : null;
    const originalText = btn ? btn.textContent : "🧹 Offload & Purge Local History";
    if (btn) { btn.textContent = "⏳ Processing..."; btn.disabled = true; btn.style.opacity = "0.7"; }

    try {
      await this.pushLegacySessionsToCloud(null, true);
      let archive = JSON.parse(localStorage.getItem('asp_session_archive')) || [];
      let initialCount = archive.length;
      let retainedArchive = archive.filter(s => s.status === 'Pending');
      let purgedCount = initialCount - retainedArchive.length;
      localStorage.setItem('asp_session_archive', JSON.stringify(retainedArchive));

      if (typeof UIManager !== 'undefined' && UIManager.evaluateSyncIndicator) {
        UIManager.evaluateSyncIndicator();
      }

      alert(`✅ Offload Complete!\n\nSuccessfully pushed any missing data to the cloud and purged ${purgedCount} old sessions from local memory. Your device storage is now optimized.`);
    } catch (err) {
      alert("Error during offload and purge: " + err.message);
    } finally {
      if (btn) { btn.textContent = originalText; btn.disabled = false; btn.style.opacity = "1"; }
    }
  },

  async fetchStagedSessions(silent = false) {
    if (!this.getActiveFeederUrl() || this.getActiveFeederUrl().includes("YOUR_")) return;

    try {
      let res = await fetch(this.getActiveFeederUrl());
      let data = await res.json();
      
      this.fetchedStagedData = data.stagedSessions || {};
      
      if (data.customerAnalytics) {
        localStorage.setItem('asp_remote_analytics', JSON.stringify(data.customerAnalytics));
        localStorage.setItem('asp_remote_customers', JSON.stringify(data.customerList));
      }
      
      let select = document.getElementById('stagedOrdersSelect');
      if (select) {
        select.innerHTML = '<option value="">-- Select Staged Order --</option>';
        let count = 0;
        for (let sessionName in this.fetchedStagedData) {
          let sessionObj = this.fetchedStagedData[sessionName];
          let items = Array.isArray(sessionObj) ? sessionObj : (sessionObj.items || []);
          if (sessionObj.isCompleted === true || sessionObj.status === 'COMPLETED') continue;

          let opt = document.createElement('option');
          opt.value = sessionName;
          opt.textContent = `📦 ${sessionName} (${items.length} items)`;
          select.appendChild(opt);
          count++;
        }

        if (typeof UIManager !== 'undefined' && UIManager.populateCustomerDropdown) {
          UIManager.populateCustomerDropdown();
        }

        if (!silent) {
          if (count > 0) alert(`Successfully synced! Found ${count} staged orders and updated Customer Analytics.`);
          else alert("Synced successfully, but no staged orders found on the ASP_Scanner_Feed tab.");
        }
      }
    } catch (err) {
      if (!silent) alert("Error syncing feed: " + err.message);
    }
  },

  async triggerQboSync(event, silent = false) {
    if (typeof AuthManager === 'undefined' || !AuthManager.currentUser || !AuthManager.currentUser.isAdmin) {
      if (!silent) alert("Access Denied: You must be an Administrator to run QuickBooks automations.");
      return;
    }
    
    const btn = event ? event.target : null;
    const originalText = btn ? btn.textContent : "Fetch QBO";
    if (btn && !silent) { btn.textContent = "⏳ Fetching QBO..."; btn.disabled = true; btn.style.opacity = "0.7"; }

    try {
      await fetch(this.getActiveFeederUrl(), {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: "FETCH_QBO" })
      });

      await this.fetchStagedSessions(true);

      if (!silent) alert("✅ QuickBooks Sync Complete! Check the Shipments & Orders Feed dropdown above.");
    } catch (err) {
      if (!silent) alert("Error triggering QBO Sync: " + err.message);
    } finally {
      if (btn && !silent) { btn.textContent = originalText; btn.disabled = false; btn.style.opacity = "1"; }
    }
  },

  loadSelectedStagedOrder(sessionName) {
    if (!sessionName || !this.fetchedStagedData[sessionName]) return;
    
    let sessionObj = this.fetchedStagedData[sessionName];
    let items = Array.isArray(sessionObj) ? sessionObj : (sessionObj.items || []);
    let isDone = sessionObj.isCompleted === true;

    if (isDone) {
      let confirmRescan = confirm(`Notice: "${sessionName}" is already marked as COMPLETED in your logs.\n\nDo you want to re-load this order into the Pre-Load Manifest for a re-scan?`);
      if (!confirmRescan) {
        document.getElementById('stagedOrdersSelect').value = "";
        return;
      }
    }

    let chk = document.getElementById('chkPreloadManifest');
    if (chk) chk.checked = true;
    
    let detailsInput = document.getElementById('orderDetailsInput');
    if (detailsInput) detailsInput.value = sessionName;
    
    this.expectedManifest = [];
    items.forEach(item => {
      let isRes = item.customerTag && !item.customerTag.toUpperCase().includes('SHELF');
      this.expectedManifest.push({
        ref: item.sku,
        expectedQty: item.qty,
        isReserved: isRes,
        customerTag: item.customerTag || '',
        reservedQty: item.qty,
        allocations: isRes ? [{ customerTag: item.customerTag, reservedQty: item.qty }] : []
      });
    });

    localStorage.setItem('asp_active_manifest', JSON.stringify(this.expectedManifest));
    alert(`Loaded "${sessionName}" with ${items.length} items into Pre-Load Manifest!`);
  },

  init() {
    let lastUser = localStorage.getItem('asp_user_name') || "";
    let userInput = document.getElementById('userNameInput');
    if (userInput && lastUser) userInput.value = lastUser;

    ['supplierSelect', 'customerSelect'].forEach(id => {
      let sel = document.getElementById(id);
      if (sel && sel.options.length > 1) {
        let opts = Array.from(sel.options);
        let first = opts.shift();
        opts.sort((a, b) => a.text.localeCompare(b.text));
        sel.innerHTML = '';
        sel.add(first);
        opts.forEach(o => sel.add(o));
      }
    });

    if (typeof UIManager !== 'undefined' && UIManager.loadFontPreference) UIManager.loadFontPreference();

    this.bindOrderInputListener(); 
  },

  startStocktakeSession(mode) {
    let uName = document.getElementById('userNameInput').value.trim();
    if (typeof AuthManager !== 'undefined' && AuthManager.isWorkstation) {
        let sel = document.getElementById('userNameSelect');
        uName = sel ? sel.value : "";
        if (!uName) { alert("Please select your User Name from the dropdown before starting a session."); return; }
    }
    
    this.currentUserName = uName || "Operator";
    this.currentSessionName = mode + " Stocktake";
    this.currentOrderNum = mode === "Full" ? "FULL-INV" : "SEL-INV";
    this.currentWorkflowType = mode + " Stocktake";
    this.isSessionActive = true;
    this.isManifestEnabled = false;

    const nowObj = new Date();
    this.sessionDateStr = `${nowObj.getFullYear()}.${String(nowObj.getMonth() + 1).padStart(2, '0')}.${String(nowObj.getDate()).padStart(2, '0')}`;
    this.sessionStartStr = nowObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    this.sessionId = Date.now().toString();
    localStorage.setItem('asp_session_id', this.sessionId);

    localStorage.setItem('asp_session_is_active', 'true');
    localStorage.setItem('asp_manifest_enabled', 'false');
    localStorage.setItem('asp_user_name', this.currentUserName);
    localStorage.setItem('asp_session_name', this.currentSessionName);
    localStorage.setItem('asp_order_num', this.currentOrderNum);
    localStorage.setItem('asp_workflow_type', this.currentWorkflowType);
    localStorage.setItem('asp_session_start_str', this.sessionStartStr);
    localStorage.setItem('asp_session_date_str', this.sessionDateStr);
    
    this.scannedObjects = [];
    this.expectedManifest = [];
    localStorage.setItem('asp_session_scanned_objects', JSON.stringify([]));
    localStorage.setItem('asp_active_manifest', JSON.stringify([]));

    this.updateHeaderBanners();
    this.updateManifestProgressUI();
    
    if (typeof UIManager !== 'undefined' && UIManager.closeStocktakeModal) UIManager.closeStocktakeModal();
    document.getElementById('screenSetup').style.display = 'none';
    document.getElementById('screenScanning').style.display = 'block';

    let destRow = document.getElementById('rowItemDestination');
    let tagRow = document.getElementById('rowCustomerTag');
    if (destRow) destRow.style.display = 'none';
    if (tagRow) tagRow.style.display = 'none';
    
    this.currentItemAction = 'Inventory';
    ScannerManager.resetScanLinesAndFields();
  },

  startSession() {
    try {
      let uName = document.getElementById('userNameInput').value.trim();
      if (typeof AuthManager !== 'undefined' && AuthManager.isWorkstation) {
          let sel = document.getElementById('userNameSelect');
          uName = sel ? sel.value : "";
          if (!uName) { alert("Please select your User Name from the dropdown before starting a session."); return; }
      }
      
      const type = document.querySelector('input[name="sessionType"]:checked').value;
      let partner = type === 'Shipment' ? document.getElementById('supplierSelect').value : document.getElementById('customerSelect').value;
      const oDetails = document.getElementById('orderDetailsInput').value.trim();
      const wType = type === 'Shipment' ? 'Receiving & Reserving' : document.getElementById('workflowTypeSelect').value;
      let chkManifest = document.getElementById('chkPreloadManifest').checked;

      if (!partner || partner === '+ Add Supplier' || partner === '+ Add Customer') {
        alert("Please select a valid Supplier or Customer.");
        return;
      }

      let preloadedAllocations = [];
      if (type === 'Order' && wType === 'Picking & Packing') {
          let currentAllocations = JSON.parse(localStorage.getItem('asp_allocations')) || {};
          let baseTag = partner.toUpperCase().trim();
          let searchTag = baseTag + (oDetails ? ` - ${oDetails.toUpperCase().trim()}` : '');
          
          let targetAllocation = currentAllocations[searchTag] ? currentAllocations[searchTag] : currentAllocations[baseTag];

          if (targetAllocation && Object.keys(targetAllocation).length > 0) {
              let itemCount = Object.keys(targetAllocation).length;
              // FIX: Safely add quantities from the new object structure
              let totalUnits = Object.values(targetAllocation).reduce((a, b) => a + (typeof b === 'object' ? (b.qty || 0) : b), 0);
              
              if (confirm(`Targeted Pick & Pack Available:\n\n${partner} has ${totalUnits} units across ${itemCount} items currently sitting in Reserve.\n\nDo you want to pre-load these items into your Pick List manifest?`)) {
                  chkManifest = true;
                  
                  for (let ref in targetAllocation) {
                      // FIX: Extract the integer quantity
                      let rawVal = targetAllocation[ref];
                      let qty = typeof rawVal === 'object' ? (rawVal.qty || 0) : rawVal;
                      
                      preloadedAllocations.push({
                          ref: ref,
                          expectedQty: qty,
                          isReserved: true,
                          customerTag: searchTag,
                          reservedQty: qty,
                          allocations: [{ customerTag: searchTag, reservedQty: qty }]
                      });
                  }
              }
          }
      }

      this.currentUserName = uName || "N/A";
      this.currentSessionName = partner + (oDetails ? ` (${oDetails})` : '');
      this.currentOrderNum = oDetails;
      this.currentWorkflowType = wType;
      this.isSessionActive = true;
      this.isManifestEnabled = chkManifest;

      const nowObj = new Date();
      this.sessionDateStr = `${nowObj.getFullYear()}.${String(nowObj.getMonth() + 1).padStart(2, '0')}.${String(nowObj.getDate()).padStart(2, '0')}`;
      this.sessionStartStr = nowObj.toLocaleTimeString();

      this.sessionId = Date.now().toString();
      localStorage.setItem('asp_session_id', this.sessionId);
      localStorage.setItem('asp_session_is_active', 'true');
      localStorage.setItem('asp_manifest_enabled', this.isManifestEnabled ? 'true' : 'false');
      localStorage.setItem('asp_user_name', this.currentUserName);
      localStorage.setItem('asp_session_name', this.currentSessionName);
      localStorage.setItem('asp_order_num', this.currentOrderNum);
      localStorage.setItem('asp_workflow_type', this.currentWorkflowType);
      localStorage.setItem('asp_session_start_str', this.sessionStartStr);
      localStorage.setItem('asp_session_date_str', this.sessionDateStr);
      
      this.scannedObjects = [];
      localStorage.setItem('asp_session_scanned_objects', JSON.stringify([]));

      this.updateHeaderBanners();

      document.getElementById('screenSetup').style.display = 'none';

      if (this.isManifestEnabled) {
        const container = document.getElementById('manifestRowsContainer');
        if (container) container.innerHTML = '';
        
        if (preloadedAllocations.length > 0) {
            this.expectedManifest = preloadedAllocations;
        }

        if (this.expectedManifest && this.expectedManifest.length > 0) {
          this.expectedManifest.forEach(item => {
            let hasAlloc = item.allocations && item.allocations.length > 0;
            let tagVal = hasAlloc ? item.allocations[0].customerTag : (item.customerTag || '');
            let resQtyVal = hasAlloc ? item.allocations[0].reservedQty : (item.reservedQty || item.expectedQty || 1);
            this.addManifestRow(item.ref || item.sku || '', item.expectedQty || item.qty || 1, hasAlloc, tagVal, resQtyVal);
          });
        } else {
          this.addManifestRow();
        }
        
        document.getElementById('screenManifestEntry').style.display = 'block';
      } else {
        this.expectedManifest = [];
        localStorage.setItem('asp_active_manifest', JSON.stringify([]));
        document.getElementById('screenScanning').style.display = 'block';
        this.updateManifestProgressUI();
      }

      let destRow = document.getElementById('rowItemDestination');
      let tagRow = document.getElementById('rowCustomerTag');
      
      // ✨ FIX: Grab the bundle checkbox wrapper
      let chkBundle = document.getElementById('chkIsBundle'); 
      let bundleWrapper = chkBundle ? chkBundle.parentElement : null;

      if (this.currentWorkflowType.includes('Receiving & Reserving')) {
        if (destRow) destRow.style.display = 'flex';
        if (tagRow) tagRow.style.display = this.currentItemAction === 'Reserved' ? 'flex' : 'none';
        if (bundleWrapper) bundleWrapper.style.display = 'block'; // Show during Receiving
      } else if (this.currentWorkflowType.includes('Reserving')) {
        if (destRow) destRow.style.display = 'none';
        if (tagRow) tagRow.style.display = 'none';
        if (bundleWrapper) bundleWrapper.style.display = 'none'; // Hide
        this.currentItemAction = 'Reserved';
      } else if (this.currentWorkflowType.includes('Packing')) {
        if (destRow) destRow.style.display = 'none';
        if (tagRow) tagRow.style.display = 'none'; 
        if (bundleWrapper) bundleWrapper.style.display = 'none'; // Hide
        this.currentItemAction = 'Pack & Ship';
      } else {
        if (destRow) destRow.style.display = 'none';
        if (tagRow) tagRow.style.display = 'none';
        if (bundleWrapper) bundleWrapper.style.display = 'none'; // Hide
        this.currentItemAction = 'Inventory';
      }

      ScannerManager.resetScanLinesAndFields();

    } catch (err) {
      console.error("Error during startSession:", err);
      alert("Encountered an issue starting session: " + err.message);
      document.getElementById('screenSetup').style.display = 'block';
      if (document.getElementById('screenManifestEntry')) document.getElementById('screenManifestEntry').style.display = 'none';
      if (document.getElementById('screenScanning')) document.getElementById('screenScanning').style.display = 'none';
    }
  },

  launchAIVisionBridge() {
    const platform = document.getElementById('aiPlatformSelect') ? document.getElementById('aiPlatformSelect').value : 'gemini';
    
    const promptText = `Analyze these attached medical inventory box photos. Group the items by REF/SKU, Quantity, Lot Number, and Expiration Date. For any item where the Lot or Expiration is unreadable or not visible, put 'N/A'.

Return ONLY a raw tab-separated table with NO extra introductory text, headers, or explanations, formatted in these exact columns:
REF [Tab] Quantity [Tab] Lot [Tab] Exp`;

    let targetUrl = 'https://gemini.google.com/app';
    let platformName = 'Gemini';

    if (platform === 'chatgpt') {
      targetUrl = 'https://chatgpt.com';
      platformName = 'ChatGPT';
    }

    navigator.clipboard.writeText(promptText).then(() => {
      alert(`AI Vision Prompt copied to your clipboard!\n\nOpening ${platformName}... Just paste (Ctrl+V) into the chat and attach your shipment photos.`);
      window.open(targetUrl, '_blank');
    }).catch(err => {
      console.error('Failed to copy prompt: ', err);
      window.open(targetUrl, '_blank');
    });
  },

  editOrderNumber() {
    let newOrderNum = prompt("Enter new Order/Invoice number (leave blank to clear):", this.currentOrderNum);
    if (newOrderNum !== null) {
      this.currentOrderNum = newOrderNum.trim();
      let baseCustomer = this.currentSessionName.split(' (')[0].trim();
      this.currentSessionName = baseCustomer + (this.currentOrderNum ? ` (${this.currentOrderNum})` : '');
      
      localStorage.setItem('asp_order_num', this.currentOrderNum);
      localStorage.setItem('asp_session_name', this.currentSessionName);
      this.updateHeaderBanners();
    }
  },

  updateHeaderBanners() {
    let editBtn = ` <button class="btn-small" style="background:transparent; border:none; color:#0277bd; cursor:pointer; font-size:1rem; padding:0; margin-left:8px;" onclick="SessionManager.editOrderNumber()" title="Edit Order Number">✏️</button>`;
    
    ['hdrTitle', 'hdrTitleRev', 'hdrTitleSum'].forEach(id => { 
      let el = document.getElementById(id);
      if(el) el.innerHTML = this.currentSessionName + editBtn; 
    });
    
    ['hdrWorkflow', 'hdrWorkflowRev', 'hdrWorkflowSum'].forEach(id => { if(document.getElementById(id)) document.getElementById(id).textContent = this.currentWorkflowType; });
    ['hdrUser', 'hdrUserRev', 'hdrUserSum'].forEach(id => { if(document.getElementById(id)) document.getElementById(id).textContent = this.currentUserName || 'N/A'; });
    ['hdrDate', 'hdrDateRev', 'hdrDateSum'].forEach(id => { if(document.getElementById(id)) document.getElementById(id).textContent = this.sessionDateStr; });
    ['hdrTime', 'hdrTimeRev', 'hdrTimeSum'].forEach(id => { if(document.getElementById(id)) document.getElementById(id).textContent = this.sessionStartStr; });
  },

  rescueLastSession() {
    if (this.scannedObjects.length === 0) { alert("No scanned items found in memory to rescue."); return; }
    this.isManifestEnabled = localStorage.getItem('asp_manifest_enabled') === 'true';
    this.updateHeaderBanners();
    this.goToSummaryScreen();
  },

  addManifestRow(refVal = '', qtyVal = 1, isRes = false, tagVal = '', resQtyVal = 1) {
    const container = document.getElementById('manifestRowsContainer');
    if (!container) return;
    const rowIdx = container.children.length;
    const div = document.createElement('div'); div.className = 'manifest-row'; div.id = `manifestRow_${rowIdx}`;
    
    let allocHtml = isRes ? `
      <div class="manifest-subrow flex-between" style="display:flex; gap:6px; margin-top:4px;">
        <input type="text" class="manifest-tag-input" placeholder="Customer Tag" value="${tagVal}" style="flex:2;">
        <input type="number" class="manifest-resqty-input" placeholder="Res Qty" value="${resQtyVal}" min="1" style="flex:1;">
        <button class="btn-small btn-cancel" onclick="this.parentElement.remove()" style="padding:4px 8px;">✕</button>
      </div>` : '';

    div.innerHTML = `
      <div style="display:flex; gap:6px; align-items:center;">
        <input type="text" class="manifest-ref-input" placeholder="REF / SKU" value="${refVal}" oninput="this.value = this.value.toUpperCase();" style="flex:2;">
        <input type="number" class="manifest-qty-input" placeholder="Total Expected Qty" value="${qtyVal}" min="1" style="flex:1;">
        <button class="btn-small btn-cancel" onclick="this.parentElement.parentElement.remove()" style="padding:4px 8px;">✕</button>
      </div>
      <div id="allocContainer_${rowIdx}">${allocHtml}</div>
      <div style="margin-top:6px;">
        <button class="btn-small btn-auto" style="font-size:0.75rem; padding:2px 8px; background-color:#0277bd;" onclick="SessionManager.addManifestAllocation(${rowIdx})">+ Add Customer Allocation</button>
      </div>
    `;
    container.appendChild(div);
  },

  addManifestAllocation(rowIdx) {
    const container = document.getElementById(`allocContainer_${rowIdx}`);
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'manifest-subrow flex-between';
    div.style.display = 'flex'; div.style.gap = '6px'; div.style.marginTop = '4px';
    div.innerHTML = `
      <input type="text" class="manifest-tag-input" placeholder="Customer Tag" style="flex:2;">
      <input type="number" class="manifest-resqty-input" placeholder="Res Qty" value="1" min="1" style="flex:1;">
      <button class="btn-small btn-cancel" onclick="this.parentElement.remove()" style="padding:4px 8px;">✕</button>
    `;
    container.appendChild(div);
  },

  toggleManifestResRow(idx) {
    const row = document.getElementById(`manifestRow_${idx}`);
    if (!row) return;
    const chk = row.querySelector('.manifest-res-chk');
    const subrow = document.getElementById(`manifestResSubrow_${idx}`);
    if (chk && subrow) subrow.style.display = chk.checked ? 'flex' : 'none';
  },

  clearManifestList() {
    if (confirm("Are you sure you want to clear all currently loaded items?")) {
      document.getElementById('manifestRowsContainer').innerHTML = '';
    }
  },

  processPastedSpreadsheet() {
    const text = document.getElementById('pasteManifestArea').value.trim();
    if (!text) { alert("Please paste spreadsheet data first."); return; }
    
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;
    
    let skuIdx = -1, qtyIdx = -1, custIdx = -1, poIdx = -1;
    let dataStartIndex = 0;
    
    for (let i = 0; i < Math.min(lines.length, 3); i++) {
      let cols = lines[i].toUpperCase().split('\t').map(c => c.trim());
      if (cols.includes('SKU') || cols.includes('REF')) {
        skuIdx = cols.indexOf('SKU') > -1 ? cols.indexOf('SKU') : cols.indexOf('REF');
        qtyIdx = cols.indexOf('QTY') > -1 ? cols.indexOf('QTY') : cols.indexOf('QUANTITY');
        custIdx = cols.indexOf('CUSTOMER') > -1 ? cols.indexOf('CUSTOMER') : cols.indexOf('CUST');
        poIdx = cols.indexOf('PO') > -1 ? cols.indexOf('PO') : cols.indexOf('INVOICE');
        dataStartIndex = i + 1;
        break;
      }
    }
    
    if (skuIdx === -1 && qtyIdx === -1) {
      let firstLineCols = lines[0].split('\t');
      dataStartIndex = (firstLineCols.length === 1 && lines.length > 1) ? 1 : 0;
      custIdx = 0; poIdx = 1; skuIdx = 2; qtyIdx = 3;
    }
    
    let parsedCount = 0;
    let lastCustomer = '', lastPO = '';
    
    for (let i = dataStartIndex; i < lines.length; i++) {
      let cols = lines[i].split('\t');
      if (cols.length < 2 && cols[0].trim() === '') continue;
      
      let rawCust = custIdx !== -1 && cols[custIdx] ? cols[custIdx].trim().toUpperCase() : '';
      let rawPO = poIdx !== -1 && cols[poIdx] ? cols[poIdx].trim().toUpperCase() : '';
      
      if (rawCust) { lastCustomer = rawCust; lastPO = rawPO; }
      
      let activeCust = rawCust || lastCustomer;
      let activePO = rawCust ? rawPO : (rawPO || lastPO);
      let ref = skuIdx !== -1 && cols[skuIdx] ? cols[skuIdx].trim().toUpperCase() : '';
      if (!ref) continue;
      
      let qtyRaw = qtyIdx !== -1 && cols[qtyIdx] ? cols[qtyIdx].replace(/\D/g, '') : '1';
      let qty = parseInt(qtyRaw, 10);
      if (isNaN(qty) || qty < 1) qty = 1;
      
      let poShelfMatch = activePO.match(/(.*?)\s*\((\d+)\)\s*SHELF\s*\((\d+)\)/i);
      let isSplitCust = activeCust.includes('/SHELF') || activeCust.includes('SHELF/');

      if (poShelfMatch || isSplitCust) {
        let realCust = activeCust.split('/')[0].trim();
        if (realCust === 'SHELF') realCust = activeCust.split('/')[1].trim() || 'UNKNOWN';
        let realPO = poShelfMatch ? poShelfMatch[1].trim() : activePO;
        
        let custQty = poShelfMatch ? parseInt(poShelfMatch[2], 10) : Math.ceil(qty / 2);
        let shelfQty = poShelfMatch ? parseInt(poShelfMatch[3], 10) : Math.floor(qty / 2);
        
        if (custQty > 0) {
          this.addManifestRow(ref, custQty, true, realCust + ((realPO && realPO !== 'NA') ? ' - ' + realPO : ''), custQty);
          parsedCount++;
        }
        if (shelfQty > 0) {
          this.addManifestRow(ref, shelfQty, false, '', 0);
          parsedCount++;
        }
        continue;
      }
      
      let isRes = false, tagVal = '', resQty = 0;
      if (activeCust && activeCust !== 'SHELF' && activeCust !== 'NA' && activeCust !== 'N/A') {
        isRes = true;
        tagVal = activeCust + ((activePO && activePO !== 'NA' && activePO !== 'N/A') ? ' - ' + activePO : '');
        resQty = qty;
      }
      
      this.addManifestRow(ref, qty, isRes, tagVal, resQty);
      parsedCount++;
    }
    if (parsedCount > 0) {
      document.getElementById('pasteManifestArea').value = '';
      alert(`Successfully parsed and added ${parsedCount} lines (including auto-splits)!`);
    } else alert("Could not extract items.");
  },

  readManifestDataFromUI() {
    const container = document.getElementById('manifestRowsContainer');
    if (!container) return [];
    let list = [];
    container.querySelectorAll('.manifest-row').forEach(row => {
      let ref = row.querySelector('.manifest-ref-input').value.trim().toUpperCase();
      let expectedQty = parseInt(row.querySelector('.manifest-qty-input').value, 10) || 1;
      let allocations = [];
      row.querySelectorAll('.manifest-subrow').forEach(subrow => {
        let tag = subrow.querySelector('.manifest-tag-input').value.trim();
        let rQty = parseInt(subrow.querySelector('.manifest-resqty-input').value, 10) || 1;
        if (tag) allocations.push({ customerTag: tag, reservedQty: rQty });
      });
      if (ref) list.push({ ref, expectedQty, allocations });
    });
    return list;
  },

  goToManifestReview() {
    this.expectedManifest = this.readManifestDataFromUI();
    if (this.expectedManifest.length === 0) { alert("Please enter at least one expected item row."); return; }
    let totalExp = this.expectedManifest.reduce((acc, curr) => acc + curr.expectedQty, 0);
    
    let html = `<div style="margin-bottom:15px; text-align:center;"><strong>Total Expected Pieces:</strong> ${totalExp} across ${this.expectedManifest.length} unique REFs</div>`;
    this.expectedManifest.forEach(item => {
      html += `<div style="border: 1px solid #0277bd; border-radius: 4px; padding: 12px; margin-bottom: 12px; background: #ffffff; text-align: center;">
        <div style="font-size: 1.2rem; color: #0277bd;"><strong>${item.ref}</strong></div>
        <div style="margin: 6px 0; font-size: 1.05rem;"><strong>Total Expected:</strong> ${item.expectedQty}</div>`;
      if (item.allocations.length > 0) {
        html += `<div style="margin-top: 10px; font-size: 0.9rem; color: #555;"><strong>Allocations:</strong><br>`;
        item.allocations.forEach(a => { html += `<span style="display:inline-block; background:#e3f2fd; color:#0277bd; padding:4px 8px; border:1px dashed #0277bd; border-radius:3px; margin:4px; font-weight:bold;">${a.customerTag} (Qty: ${a.reservedQty})</span><br>`; });
        html += `</div>`;
      } else {
        html += `<div style="margin-top: 10px; font-size: 0.85rem; color: #757575;"><em>All routed to standard Inventory.</em></div>`;
      }
      html += `</div>`;
    });
    document.getElementById('manifestReviewSummaryContainer').innerHTML = html;
    document.getElementById('screenManifestEntry').style.display = 'none';
    document.getElementById('screenManifestReview').style.display = 'block';
  },

  returnToManifestEdit() {
    document.getElementById('screenManifestReview').style.display = 'none';
    document.getElementById('screenManifestEntry').style.display = 'block';
  },

  cancelManifestEntry() {
    document.getElementById('screenManifestEntry').style.display = 'none';
    document.getElementById('screenSetup').style.display = 'block';
  },

  confirmManifestAndStart() {
    localStorage.setItem('asp_active_manifest', JSON.stringify(this.expectedManifest));
    document.getElementById('screenManifestReview').style.display = 'none';
    document.getElementById('screenScanning').style.display = 'block';
    this.updateManifestProgressUI();
  },

  updateManifestProgressUI() {
    const banner = document.getElementById('manifestProgressBanner');
    const tracker = document.getElementById('liveManifestTracker');
    
    if (!this.isManifestEnabled || this.expectedManifest.length === 0) { 
      if (banner) banner.style.display = 'none'; 
      if (tracker) tracker.style.display = 'none';
      return; 
    }
    
    if (banner) banner.style.display = 'block';
    if (tracker) tracker.style.display = 'block';

    // Aggregate Expected Manifest by REF
    let expectedMap = {};
    this.expectedManifest.forEach(exp => {
        expectedMap[exp.ref] = (expectedMap[exp.ref] || 0) + exp.expectedQty;
    });

    let scannedMap = {};
    this.scannedObjects.forEach(i => { scannedMap[i.ref] = (scannedMap[i.ref] || 0) + i.qty; });

    let expHtml = '';
    let totalExpected = 0;
    let totalScannedExp = 0;
    let totalUnexpected = 0;

    // Sort manifest items by Shelf Location first, then by REF
    Object.keys(expectedMap).sort((a, b) => {
        let dbItemA = DatabaseManager.db.find(i => (i.sku || i.ref || '').toUpperCase() === a) || {};
        let dbItemB = DatabaseManager.db.find(i => (i.sku || i.ref || '').toUpperCase() === b) || {};
        let shelfA = dbItemA.shelf || 'ZZZ-UNASSIGNED';
        let shelfB = dbItemB.shelf || 'ZZZ-UNASSIGNED';
        return shelfA.localeCompare(shelfB) || a.localeCompare(b);
    }).forEach(ref => {
        let eQty = expectedMap[ref];
        let sQty = scannedMap[ref] || 0;
        
        let dbMatch = DatabaseManager.db.find(i => (i.sku || i.ref || '').toUpperCase() === ref) || {};
        let shelfStr = (dbMatch.shelf && dbMatch.shelf !== 'ZZZ-UNASSIGNED') ? 
            `<span style="font-size:0.7rem; background:#e0e0e0; color:#333; padding:2px 6px; border-radius:4px; margin-left:8px;">📍 ${dbMatch.shelf}</span>` : '';

        totalExpected += eQty;
        totalScannedExp += Math.min(sQty, eQty);
        
        let color = sQty >= eQty ? '#2e7d32' : (sQty > 0 ? '#f57f17' : '#555');
        let icon = sQty >= eQty 
            ? '<i data-lucide="check-circle-2" style="width:16px; height:16px; vertical-align:text-bottom;"></i>' 
            : '<i data-lucide="hourglass" style="width:16px; height:16px; vertical-align:text-bottom;"></i>';
        
        expHtml += `<div style="display:flex; justify-content:space-between; border-bottom:1px solid #e0e0e0; padding:8px 4px; align-items:center;">
          <div><span style="font-weight:bold; color:${color};">${icon} ${ref}</span>${shelfStr}</div>
          <span style="color:${color}; font-weight:bold; font-size:1.1rem;">${sQty} / ${eQty}</span>
        </div>`;
    });

    Object.keys(scannedMap).sort().forEach(sRef => {
        let sQty = scannedMap[sRef];
        let eQty = expectedMap[sRef] || 0;
        if (sQty > eQty) {
            let diff = sQty - eQty;
            totalUnexpected += diff;
            if (eQty === 0) {
                expHtml += `<div style="display:flex; justify-content:space-between; border-bottom:1px solid #e0e0e0; padding:6px 4px; background-color: #fff3e0;">
                  <span style="font-weight:bold; color:#e65100;">⚠️ ${sRef} (Unexpected)</span>
                  <span style="color:#e65100; font-weight:bold;">${sQty}</span>
                </div>`;
            }
        }
    });

    document.getElementById('manifestScannedQty').textContent = totalScannedExp;
    document.getElementById('manifestTotalQty').textContent = totalExpected;
    
    let unexpHtml = totalUnexpected > 0 ? ` | <span style="color:#e65100;">${totalUnexpected} Unexpected</span>` : '';
    document.getElementById('manifestUnexpectedStats').innerHTML = unexpHtml;

    if (document.getElementById('liveManifestList')) {
      document.getElementById('liveManifestList').innerHTML = expHtml;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  },

  confirmFieldUpdate(field) {
    if (!this.currentMatchedItem) return;
    if (field === 'gtin' && this.pendingUpdates['gtin']) {
      this.currentMatchedItem.gtin = this.pendingUpdates['gtin'];
      alert(`Database updated: GTIN ${this.pendingUpdates['gtin']} linked to REF ${DatabaseManager.getItemSku(this.currentMatchedItem)}!`);
    } else if (field === 'mfr') {
      let selectedMfr = document.getElementById('vendorSelect').value;
      this.currentMatchedItem.mfr = selectedMfr;
      this.currentMatchedItem.manufacturer = selectedMfr;
      alert(`Database updated: Manufacturer updated for REF ${DatabaseManager.getItemSku(this.currentMatchedItem)}!`);
    }
    this.pendingFieldUpdates.push({
      ref: DatabaseManager.getItemSku(this.currentMatchedItem),
      field: field === 'gtin' ? 'GTIN' : 'Manufacturer',
      newValue: field === 'gtin' ? this.pendingUpdates['gtin'] : document.getElementById('vendorSelect').value,
      timestamp: new Date().toLocaleString()
    });
    localStorage.setItem('asp_pending_updates', JSON.stringify(this.pendingFieldUpdates));
    localStorage.setItem('asp_wh_db', JSON.stringify(DatabaseManager.db));
    UIManager.hideAllConfirmButtons();
  },  

  goToReviewStage() {
    let expField = document.getElementById('expInput');
    if (expField && expField.value.trim() !== "" && !document.getElementById('chkNaExp').checked) {
      UIManager.formatExpDate(expField);
    }
    
    const ref = document.getElementById('refInput').value.trim().toUpperCase();
    if (!ref) { 
      alert("Please enter or scan a REF/SKU before continuing."); 
      return; 
    }
    
    const gtin = document.getElementById('gtinInput').value.trim();
    const lot = document.getElementById('lotInput').value.trim().toUpperCase();
    const exp = document.getElementById('expInput').value.trim();
    const vendor = document.getElementById('vendorSelect').value;
    const qty = parseInt(document.getElementById('qtyInput').value, 10) || 1;
    
    // Safely grab the Customer and Order strings for the Review Screen
    const custVal = document.getElementById('itemCustomerSelect') ? document.getElementById('itemCustomerSelect').value : '';
    const ordVal = document.getElementById('itemOrderNumInput') ? document.getElementById('itemOrderNumInput').value.trim() : '';
    const cTag = custVal + (ordVal ? ` - ${ordVal}` : '');
    const iNote = document.getElementById('itemNoteInput') ? document.getElementById('itemNoteInput').value.trim() : '';

    const refProgRow = document.getElementById('revRefProgressRow');
    const totalProgRow = document.getElementById('revTotalProgressRow');
    const refProgText = document.getElementById('revRefProgress');
    const totalProgText = document.getElementById('revTotalProgress');

    if (this.isManifestEnabled && this.expectedManifest.length > 0) {
      if (refProgRow) refProgRow.style.display = 'flex';
      if (totalProgRow) totalProgRow.style.display = 'flex';
      
      // Sum up all expected occurrences of this REF
      let totalExpectedForRef = this.expectedManifest.filter(i => i.ref === ref).reduce((acc, curr) => acc + curr.expectedQty, 0);

      let scannedRefQtySoFar = this.scannedObjects.filter(i => i.ref === ref).reduce((acc, curr) => acc + (parseInt(curr.qty, 10) || 0), 0);
      let newTotalScannedForRef = scannedRefQtySoFar + qty;
      
      if (refProgText) {
        if (totalExpectedForRef > 0) refProgText.textContent = `${newTotalScannedForRef} Scanned / ${totalExpectedForRef} Expected`;
        else refProgText.innerHTML = `<span class="badge-info badge-alert">⚠️ Unexpected Item (Not on Manifest)</span>`;
      }
      
      let totalScannedOverall = this.scannedObjects.reduce((acc, curr) => acc + (parseInt(curr.qty, 10) || 0), 0) + qty;
      let totalExpectedOverall = this.expectedManifest.reduce((acc, curr) => acc + curr.expectedQty, 0);
      if (totalProgText) totalProgText.textContent = `${totalScannedOverall} / ${totalExpectedOverall} Total Order Items`;
    } else {
      if (refProgRow) refProgRow.style.display = 'none';
      if (totalProgRow) totalProgRow.style.display = 'none';
    }

    if (document.getElementById('revRef')) document.getElementById('revRef').textContent = ref;
    if (document.getElementById('revGtin')) document.getElementById('revGtin').textContent = gtin || '--';
    if (document.getElementById('revLot')) document.getElementById('revLot').textContent = lot || '--';
    if (document.getElementById('revExp')) document.getElementById('revExp').textContent = exp || '--';
    if (document.getElementById('revMfr')) document.getElementById('revMfr').textContent = vendor;
    if (document.getElementById('revQty')) document.getElementById('revQty').textContent = qty;
    
    if (document.getElementById('revItemNoteRow')) {
      document.getElementById('revItemNoteRow').style.display = iNote ? 'flex' : 'none';
      if (document.getElementById('revItemNote')) document.getElementById('revItemNote').textContent = ' ' + iNote;
    }

    if (document.getElementById('revDesc')) {
      document.getElementById('revDesc').textContent = DatabaseManager.getItemDesc(this.currentMatchedItem) || "Navigate to vendor website for item description.";
    }
    if (document.getElementById('revPrice')) {
      document.getElementById('revPrice').textContent = (this.currentMatchedItem && this.currentMatchedItem.price) ? this.currentMatchedItem.price : "$0.00";
    }

    if (document.getElementById('revAction')) {
      document.getElementById('revAction').textContent = this.currentItemAction;
    }
    if (document.getElementById('revActionRow')) {
      document.getElementById('revActionRow').style.display = this.currentWorkflowType.includes('Receiving & Reserving') ? 'flex' : 'none';
    }
    
    let tagRow = document.getElementById('rowCustomerTag');
    let revTagRow = document.getElementById('revCustomerTagRow');
    if (tagRow && tagRow.style.display !== 'none' && revTagRow) {
      revTagRow.style.display = 'flex'; 
      if (document.getElementById('revCustomerTag')) document.getElementById('revCustomerTag').textContent = ' ' + (cTag || 'NONE');
    } else if (revTagRow) { 
      revTagRow.style.display = 'none'; 
    }

    let diffBanner = document.getElementById('gtinDiffBanner');
    let btnGtin = document.getElementById('btnConfirmGtin');
    if (this.currentMatchedItem && gtin && gtin !== "N/A" && this.currentMatchedItem.gtin !== gtin) {
      this.pendingUpdates['gtin'] = gtin;
      if (btnGtin) btnGtin.style.display = 'inline-block';
      if (diffBanner) {
        diffBanner.textContent = this.currentMatchedItem.gtin ? `⚠️ Replace Saved GTIN (${this.currentMatchedItem.gtin}) with Scanned GTIN (${gtin})?` : `[Link New GTIN: ${gtin}]`;
        diffBanner.style.display = 'block';
      }
    } else {
      if (btnGtin) btnGtin.style.display = 'none';
      if (diffBanner) diffBanner.style.display = 'none';
    }

    let btnMfr = document.getElementById('btnConfirmMfr');
    if (btnMfr) {
      btnMfr.style.display = (this.currentMatchedItem && DatabaseManager.getItemVendor(this.currentMatchedItem).toLowerCase() !== vendor.toLowerCase()) ? 'inline-block' : 'none';
    }    

    document.getElementById('screenScanning').style.display = 'none';
    document.getElementById('screenReview').style.display = 'block';
  },

  returnToEdit() {
    // ✨ FIX: Properly reset the bundle UI after the item is saved or cancelled
    let bundleChk = document.getElementById('chkIsBundle');
    let bundleRow = document.getElementById('rowBundleData');
    if (bundleChk) bundleChk.checked = false;
    if (bundleRow) bundleRow.style.display = 'none';
    if (document.getElementById('bundleParentRef')) document.getElementById('bundleParentRef').value = '';
    if (document.getElementById('bundleMult')) document.getElementById('bundleMult').value = '';

    document.getElementById('screenReview').style.display = 'none';
    document.getElementById('screenScanning').style.display = 'block';
  },

  cancelScannedItem() {
    if (confirm("Are you sure you want to discard this scanned item?")) {
      ScannerManager.resetScanLinesAndFields();
      this.returnToEdit();
    }
  },

  saveItemLog(ignoreOverpack = false) {
    let rawGtin = document.getElementById('gtinInput').value.trim();
    let ref = document.getElementById('refInput').value.trim().toUpperCase();
    const lot = document.getElementById('lotInput').value.trim().toUpperCase();
    const exp = document.getElementById('expInput').value.trim();
    const vendor = document.getElementById('vendorSelect').value;
    let qty = parseInt(document.getElementById('qtyInput').value, 10) || 1;
    
    const itemCust = document.getElementById('itemCustomerSelect') ? document.getElementById('itemCustomerSelect').value : '';
    const itemOrder = document.getElementById('itemOrderNumInput') ? document.getElementById('itemOrderNumInput').value.trim() : '';
    const iNote = document.getElementById('itemNoteInput') ? document.getElementById('itemNoteInput').value.trim() : '';

    let matchedDbItem = InventoryEngine.lookupAndNormalize(ref, rawGtin, DatabaseManager.db);
    
    if (!matchedDbItem) {
      let pendingMatch = this.pendingNewItems.find(i => (i.sku || i.ref || '').toUpperCase() === ref.toUpperCase());
      if (pendingMatch) {
        matchedDbItem = pendingMatch; 
      }
    }

    let uomResult = InventoryEngine.calculateUOM(matchedDbItem, qty, ref);
    
    if (matchedDbItem && uomResult.trueRef !== matchedDbItem.sku && uomResult.trueRef !== matchedDbItem.ref) {
      if (typeof UIManager !== 'undefined') {
          UIManager.showCustomAlert("UOM Conversion", `Box Barcode (${ref.toUpperCase()}) Detected. Converted to ${uomResult.trueQty} individual units of ${uomResult.trueRef}.`);
      }
      rawGtin = "N/A"; 
      
      // ✨ FIX: Check the master DB first, then check the pending memory!
      matchedDbItem = DatabaseManager.db.find(i => (i.sku || i.ref || '').toUpperCase() === uomResult.trueRef);
      if (!matchedDbItem) {
          matchedDbItem = this.pendingNewItems.find(i => (i.sku || i.ref || '').toUpperCase() === uomResult.trueRef);
      }
    }

    ref = uomResult.trueRef;
    qty = uomResult.trueQty;

    let isNewItem = !matchedDbItem;
    let pRef = "";
    let uMult = 1;

    if (isNewItem) {
       let bundleChk = document.getElementById('chkIsBundle');
       let isBundle = bundleChk && bundleChk.checked;
       let bundleWarning = "";

       if (isBundle) {
           pRef = document.getElementById('bundleParentRef').value.trim().toUpperCase();
           uMult = parseInt(document.getElementById('bundleMult').value, 10) || 1;
           if (!pRef || uMult <= 1) {
               UIManager.showCustomAlert("Bundle Error", "Please provide a valid Parent REF and a Units Per Box quantity greater than 1.");
               return;
           }
           // ✨ FIX: Modify the warning text to be explicit about creating two items
           bundleWarning = `\n\n📦 BUNDLE DETECTED:\nThis will create the Box Barcode "${ref}" AND silently create the Individual Item "${pRef}" if it does not already exist.`;
       }

       let confirmNew = confirm(`⚠️ UNRECOGNIZED REF DETECTED ⚠️\n\nThe REF/SKU "${ref}" does not exist in the master database.${bundleWarning}\n\nAre you sure you want to create a BRAND NEW item? If this is a typo, click Cancel and fix the REF.`);
       if (!confirmNew) return; 

       let alreadyPending = this.pendingNewItems.find(i => i.ref === ref);
       if (!alreadyPending) {
           this.pendingNewItems.push({
               ref: ref,
               gtin: rawGtin,
               mfr: vendor,
               price: "$0.00",
               desc: "Navigate to vendor website for item description.",
               parentRef: pRef,
               uomMult: uMult
           });
       }

       if (pRef && uMult > 1) {
           ref = pRef;
           qty = qty * uMult;
           matchedDbItem = DatabaseManager.db.find(i => (i.sku || i.ref || '').toUpperCase() === pRef);
           
           if (!matchedDbItem) {
               let parentAlreadyPending = this.pendingNewItems.find(i => i.ref === pRef);
               if (!parentAlreadyPending) {
                   this.pendingNewItems.push({
                       ref: pRef,
                       gtin: "", 
                       mfr: vendor,
                       price: "$0.00",
                       desc: "Navigate to vendor website for item description.",
                       parentRef: "", 
                       uomMult: 1
                   });
               }
           }
       }
       
       localStorage.setItem('asp_pending_new_items', JSON.stringify(this.pendingNewItems));
    }

    let effectiveTag = this.currentItemAction;
    if (!this.currentWorkflowType.includes('Receiving & Reserving')) {
      if (this.currentWorkflowType.includes('Reserving')) effectiveTag = 'Reserved';
      else if (this.currentWorkflowType.includes('Packing')) effectiveTag = 'Pack & Ship';
      else effectiveTag = 'Inventory';
    }

    let finalCustomerTag = itemCust;
    let finalOrderNum = itemOrder;

    if (!this.currentWorkflowType.includes('Receiving & Reserving')) {
      let baseCustomer = this.currentSessionName.split('(')[0].trim();
      if (!finalCustomerTag) finalCustomerTag = baseCustomer;
      if (!finalOrderNum) finalOrderNum = this.currentOrderNum;
    }
    
    if (finalCustomerTag.toUpperCase().trim() === "ASP DAMAGED INVENTORY" && iNote) {
      finalOrderNum = iNote;
    }

    let cTagCombined = finalCustomerTag + (finalOrderNum ? ` - ${finalOrderNum}` : '');

    let bypassOverpackWarning = ignoreOverpack || !this.isManifestEnabled;

    try {
      let currentAllocations = JSON.parse(localStorage.getItem('asp_allocations')) || {};
      InventoryEngine.validateAvailability(ref, qty, effectiveTag, DatabaseManager.db, cTagCombined, currentAllocations, bypassOverpackWarning, this.currentWorkflowType);
    } catch (error) {
      if (error.message.startsWith('OVERPACK_WARNING:')) {
        let friendlyMsg = `You just scanned an item that isn't on the original reserve list or exceeds the expected quantity for this customer.\n\nDo you want to pull this from general inventory and add it to their shipment anyway?`;
        UIManager.showCustomConfirm("📦 Extra Item Detected", friendlyMsg, () => {
          SessionManager.saveItemLog(true); 
        });
        return; 
      } else {
        UIManager.showCustomAlert("Inventory Error", error.message, true);
        return; 
      }
    }

    const desc = DatabaseManager.getItemDesc(matchedDbItem) || "Navigate to vendor website for item description.";
    const price = (matchedDbItem && matchedDbItem.price) ? matchedDbItem.price : "$0.00";
        
    let rawBarcodesGathered = [];
    for (let i = 1; i <= 4; i++) {
      let val = document.getElementById(`rawScan${i}`).value.trim();
      if (val) rawBarcodesGathered.push(val.replace(/^\][a-zA-Z0-9]{2}/, '').replace(/[\x00-\x1F\x7F-\x9F]/g, ''));
    }

    if (this.currentMatchedItem && rawGtin && rawGtin !== "N/A" && !this.currentMatchedItem.gtin) {
      this.currentMatchedItem.gtin = rawGtin;
      let dbMatch = DatabaseManager.db.find(i => (i.sku || i.ref || '').toUpperCase() === ref.toUpperCase());
      if (dbMatch) dbMatch.gtin = rawGtin;
      localStorage.setItem('asp_wh_db', JSON.stringify(DatabaseManager.db));
    }

    this.scannedObjects.push({
      actionTag: effectiveTag,
      gtin: rawGtin || (this.currentMatchedItem ? this.currentMatchedItem.gtin : ''),
      ref: ref,
      lot: lot || 'NO_LOT',
      exp: exp || 'NO_EXP',
      mfr: vendor,
      desc: desc,
      price: price,
      qty: qty,
      rawScanLines: rawBarcodesGathered,
      isNew: isNewItem, 
      customerTag: (effectiveTag === 'Reserved' || effectiveTag === 'Pack & Ship' ? cTagCombined : ''),
      orderNum: (effectiveTag === 'Reserved' || effectiveTag === 'Pack & Ship' ? finalOrderNum : ''),
      sessionId: this.sessionId,
      itemNote: iNote
    });
    localStorage.setItem('asp_session_scanned_objects', JSON.stringify(this.scannedObjects));

    ScannerManager.resetScanLinesAndFields();
    this.updateManifestProgressUI();
    this.returnToEdit();

    this.saveToArchive('Pending');
  },

  goToSummaryScreen() {
    if (ScannerManager.isCameraActive) ScannerManager.toggleCameraScanner();
    document.getElementById('screenScanning').style.display = 'none';
    document.getElementById('screenReview').style.display = 'none';
    AuditManager.updateSessionSummaryView();
    
    // NEW STRICT DROPDOWN LOGIC
    let optCommit = document.getElementById('optCommitStock');
    let optComplete = document.querySelector('#exportDropdown option[value="complete"]');
    let isStocktake = this.currentWorkflowType.includes('Stocktake');

    if (optCommit) {
      optCommit.style.display = isStocktake ? 'block' : 'none';
      if (optComplete) optComplete.style.display = isStocktake ? 'none' : 'block';
      
      // Auto-select the correct completion action
      if (isStocktake) {
        document.getElementById('exportDropdown').value = 'commit_stock';
      } else {
        document.getElementById('exportDropdown').value = 'continue';
      }
    }

    this.renderManifestReconciliation();
    this.renderAdvancedReview(); 
    
    document.getElementById('screenSummary').style.display = 'block';
  },

  getVendorSearchUrl(mfr, ref) {
    let cleanMfr = (mfr || '').toUpperCase();
    if (cleanMfr.includes('ETHICON')) return 'https://www.ethicon.com/na/epc/search/';
    if (cleanMfr.includes('SYNERGY')) return 'https://www.synergysurgical.com/search/';
    
    return `https://www.google.com/search?q=${encodeURIComponent(mfr + ' ' + ref)}`;
  },

  renderAdvancedReview() {
    const card = document.getElementById('advancedReviewCard');
    const list = document.getElementById('advancedItemsList');
    if (!card || !list) return;

    if (!Array.isArray(this.pendingNewItems)) {
      this.pendingNewItems = [];
    }

    let unresolved = this.pendingNewItems.filter(i => i.desc === "Navigate to vendor website for item description." || !i.desc);
    
    if (unresolved.length === 0) {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';
    list.innerHTML = '';

    unresolved.forEach((item, index) => {
      let searchUrl = this.getVendorSearchUrl(item.mfr, item.ref);
      let div = document.createElement('div');
      div.style.marginBottom = '10px';
      div.style.padding = '10px';
      div.style.backgroundColor = '#ffffff';
      div.style.border = '1px solid #90caf9';
      div.style.borderRadius = '4px';

      div.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div><strong style="color: #0277bd;">${item.ref}</strong> <span style="font-size:0.8rem; color:#555; margin-left: 6px;">${item.mfr}</span></div>
          <button class="btn-small" style="background-color:#1976d2; color:#ffffff; padding: 4px 10px;" onclick="window.open('${searchUrl}', '_blank')">🔍 Search</button>
        </div>
        <div style="display:flex; align-items:center; gap:6px; background:#f5f5f5; padding:6px; border-radius:4px; border:1px solid #ccc;">
          <span style="font-size:0.85rem; font-weight:bold; color:#555; white-space:nowrap;">${item.mfr}</span>
          <input type="text" id="advDesc_${index}" class="adv-desc-input" data-ref="${item.ref}" data-mfr="${item.mfr}" placeholder="Paste website description here..." style="flex:1; padding:6px; border: 1px solid #ccc; border-radius: 4px;">
          <span style="font-size:0.85rem; font-weight:bold; color:#555; white-space:nowrap;">${item.ref}</span>
        </div>
      `;
      list.appendChild(div);
    });
  },

  saveAdvancedDescriptions() {
    const inputs = document.querySelectorAll('.adv-desc-input');
    let updatedCount = 0;

    inputs.forEach(input => {
      let rawDesc = input.value.trim();
      let ref = input.getAttribute('data-ref');
      let mfr = input.getAttribute('data-mfr');
      
      if (rawDesc && rawDesc !== "Navigate to vendor website for item description.") {
        let newDesc = `${mfr} ${rawDesc} ${ref}`.replace(/\s+/g, ' ').trim();
        
        let pendingItem = this.pendingNewItems.find(i => i.ref === ref);
        if (pendingItem) pendingItem.desc = newDesc;

        let dbItem = DatabaseManager.db.find(i => (i.sku || i.ref || '').toUpperCase() === ref.toUpperCase());
        if (dbItem) dbItem.desc = newDesc;

        this.scannedObjects.forEach(scanned => {
          if (scanned.ref === ref && scanned.isNew) {
            scanned.desc = newDesc;
          }
        });
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      localStorage.setItem('asp_wh_db', JSON.stringify(DatabaseManager.db));
      localStorage.setItem('asp_pending_new_items', JSON.stringify(this.pendingNewItems));
      localStorage.setItem('asp_session_scanned_objects', JSON.stringify(this.scannedObjects));
      
      alert(`Successfully updated ${updatedCount} descriptions!`);
      this.renderAdvancedReview();
    } else {
      alert("No new descriptions were entered.");
    }
  },

  cancelSession() {
    UIManager.showCustomConfirm("Cancel Session", "Are you sure you want to CANCEL this scanning session? All items scanned during this session will be discarded.", () => {
      this.saveToArchive('Cancelled');
      this.isSessionActive = false; this.isManifestEnabled = false;
      localStorage.setItem('asp_session_is_active', 'false'); localStorage.setItem('asp_manifest_enabled', 'false');
      this.scannedObjects = []; this.expectedManifest = [];
      localStorage.setItem('asp_session_scanned_objects', JSON.stringify([])); localStorage.setItem('asp_active_manifest', JSON.stringify([]));

      let recList = document.getElementById('manifestReconcileList');
      let recCard = document.getElementById('manifestReconcileCard');
      if (recList) recList.innerHTML = '';
      if (recCard) recCard.style.display = 'none';

      if (ScannerManager.isCameraActive) ScannerManager.toggleCameraScanner();
      document.getElementById('sessionNoteInput').value = ""; document.getElementById('chkSessionNote').checked = false;
      document.getElementById('orderDetailsInput').value = ""; 
      if (typeof UIManager !== 'undefined' && UIManager.toggleSessionNote) UIManager.toggleSessionNote();

      const chkPreload = document.getElementById('chkPreloadManifest');
      if (chkPreload) chkPreload.checked = false;

      document.getElementById('screenScanning').style.display = 'none';
      document.getElementById('screenReview').style.display = 'none';
      document.getElementById('screenSummary').style.display = 'none';
      document.getElementById('screenSetup').style.display = 'block';

      this.currentItemAction = 'Inventory'; // FIX
    });
  },

  completeSession(skipConfirm = false) {
    const executeCompletion = async () => {
      
      let overlay = document.createElement('div');
      overlay.id = 'sessionSaveOverlay';
      overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:999999; display:flex; flex-direction:column; justify-content:center; align-items:center; color:#fff;';
      overlay.innerHTML = `
        <div style="background:#fff; border-radius:8px; width:100%; max-width:400px; padding:20px; box-shadow:0 4px 20px rgba(0,0,0,0.5); text-align:center;">
          <h3 style="margin:0 0 15px 0; color:#0277bd;">💾 Committing Session</h3>
          <div id="syncStep1" style="margin-bottom:10px; font-weight:bold; color:#555;">⏳ 1. Applying Ledger Math...</div>
          <div id="syncStep2" style="margin-bottom:10px; font-weight:bold; color:#555;">⏳ 2. Transmitting to Google...</div>
          <div id="syncStep3" style="margin-bottom:15px; font-weight:bold; color:#555;">⏳ 3. Verifying Uploads...</div>
          <div style="width:100%; background:#eee; border-radius:4px; height:8px; overflow:hidden;">
            <div id="syncProgressBar" style="width:0%; height:100%; background:#2e7d32; transition:width 0.3s ease;"></div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const updateStep = (stepNum, text, progress) => {
        let el = document.getElementById(`syncStep${stepNum}`);
        if (el) el.innerHTML = `✅ <span style="color:#2e7d32;">${text}</span>`;
        let pBar = document.getElementById('syncProgressBar');
        if (pBar) pBar.style.width = `${progress}%`;
      };

      try {
        this.scannedObjects.forEach((item, index) => {
          let qtyEl = document.getElementById(`editQty_${index}`);
          let tagEl = document.getElementById(`editTag_${index}`);
          if (qtyEl) {
            item.qty = parseInt(qtyEl.value, 10) || 1;
            if (tagEl) {
              let newTag = tagEl.value.trim().toUpperCase();
              item.customerTag = newTag;
              if (newTag && this.currentWorkflowType.includes('Receiving')) {
                item.actionTag = 'Reserved';
              }
            }
          }
        });
        localStorage.setItem('asp_session_scanned_objects', JSON.stringify(this.scannedObjects));

        let currentAllocations = JSON.parse(localStorage.getItem('asp_allocations')) || {};

        this.scannedObjects.forEach(item => {
          if (this.currentWorkflowType.includes('Packing') && this.isManifestEnabled) {
             let manifestItem = this.expectedManifest.find(m => m.ref === item.ref.toUpperCase());
             if (manifestItem && manifestItem.allocations && manifestItem.allocations.length > 0) { 
                 item.customerTag = manifestItem.allocations[0].customerTag; 
             }
          }
        });

        if (this.pendingNewItems && this.pendingNewItems.length > 0) {
          this.pendingNewItems.forEach(newItem => { 
            let exists = DatabaseManager.db.find(i => (i.sku || i.ref || '').toUpperCase() === (newItem.ref || newItem.sku || '').toUpperCase()); 
            if (!exists) DatabaseManager.db.push(newItem); 
          });
        }

        let ledgerResult = InventoryEngine.commitLedgerMath(this.scannedObjects, DatabaseManager.db, currentAllocations, this.currentWorkflowType);
        localStorage.setItem('asp_allocations', JSON.stringify(ledgerResult.updatedAllocations));

        if (this.pendingFieldUpdates && this.pendingFieldUpdates.length > 0) {
          this.pendingFieldUpdates.forEach(update => { 
            let dbItem = ledgerResult.updatedDb.find(i => (i.sku || i.ref || '').toUpperCase() === update.ref.toUpperCase()); 
            if (dbItem && update.field) dbItem[update.field] = update.value; 
          });
        }
        
        DatabaseManager.db = ledgerResult.updatedDb;
        localStorage.setItem('asp_wh_db', JSON.stringify(DatabaseManager.db));

        let dbPayload = null;
        let archiveUrl = this.getActiveArchiveUrl();
        if (archiveUrl) {
            dbPayload = { 
              action: "SYNC_LOCAL_DB", 
              payload: { 
                items: DatabaseManager.db,
                customers: DatabaseManager.customers.filter(c => !c.startsWith("+") && c !== "#ERROR!"),
                suppliers: DatabaseManager.suppliers.filter(s => !s.startsWith("+") && s !== "#ERROR!"),
                vendors: DatabaseManager.vendors.filter(v => !v.startsWith("+") && v !== "#ERROR!")
              } 
            };
        }

        let completedSessionObj = this.saveToArchive('Completed');
        
        // ✨ Yield thread to repaint UI visually
        updateStep(1, "Ledger Math Applied", 33);
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 100))); 

        // --- CONCURRENT UPLOAD FOR LIGHTNING SPEED ---
        updateStep(2, "Transmitting to Google...", 66);
        let networkTasks = [];
        
        networkTasks.push(this.syncAllocationsToCloud());
        
        if (archiveUrl && dbPayload) {
            networkTasks.push(fetch(archiveUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(dbPayload) }).catch(e => {}));
        }
        
        if (completedSessionObj) {
            networkTasks.push(this.pushToCloudArchive(completedSessionObj));
            networkTasks.push(this.pushQboWriteBack(completedSessionObj));
        }

        await Promise.all(networkTasks);
        
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 1000))); 
        
        updateStep(3, "Session Safely Archived!", 100);
        await new Promise(r => setTimeout(r, 300)); 

        // ✨ FIX: Mark the local session as officially synced so the red dot doesn't appear
        if (completedSessionObj) {
            let localArchive = JSON.parse(localStorage.getItem('asp_session_archive')) || [];
            let targetIdx = localArchive.findIndex(s => s.id === completedSessionObj.id);
            if (targetIdx > -1) {
                localArchive[targetIdx].isSynced = true;
                localStorage.setItem('asp_session_archive', JSON.stringify(localArchive));
            }
        }

        // ✨ FIX: Update the Cloud Sync timestamp instantly so the app knows *we* caused the cloud update
        localStorage.setItem('asp_last_cloud_sync', Date.now().toString());

        this.pendingNewItems = []; this.pendingFieldUpdates = [];
        localStorage.setItem('asp_pending_new_items', JSON.stringify([])); 
        localStorage.setItem('asp_pending_updates', JSON.stringify([]));
        
        let recList = document.getElementById('manifestReconcileList');
        let recCard = document.getElementById('manifestReconcileCard');
        if (recList) recList.innerHTML = '';
        if (recCard) recCard.style.display = 'none';

        document.getElementById('sessionNoteInput').value = ""; document.getElementById('chkSessionNote').checked = false;
        document.getElementById('orderDetailsInput').value = ""; 
        if (typeof UIManager !== 'undefined' && UIManager.toggleSessionNote) UIManager.toggleSessionNote();

        const chkPreload = document.getElementById('chkPreloadManifest');
        if (chkPreload) chkPreload.checked = false;
        
        this.isSessionActive = false; this.isManifestEnabled = false;
        localStorage.setItem('asp_session_is_active', 'false'); localStorage.setItem('asp_manifest_enabled', 'false');
        this.currentItemAction = 'Inventory'; 

        document.body.removeChild(overlay);

        document.getElementById('screenSummary').style.display = 'none';
        document.getElementById('screenSetup').style.display = 'block';
        if (typeof UIManager !== 'undefined') UIManager.showCustomAlert("Session Complete", "✅ All inventory math and cloud syncs finished successfully!");
        
        if (typeof UIManager !== 'undefined' && UIManager.evaluateSyncIndicator) UIManager.evaluateSyncIndicator();

      } catch (err) {
        let overlayEl = document.getElementById('sessionSaveOverlay');
        if (overlayEl) document.body.removeChild(overlayEl);
        alert("Error during session commit: " + err.message);
      }
    };

    if (!skipConfirm) {
      UIManager.showCustomConfirm("Complete Session", "Are you ready to complete this session?", executeCompletion);
    } else {
      executeCompletion();
    }
  },

  commitStocktake() {
    if (!this.currentWorkflowType.includes('Stocktake')) return;
    
    let noteEl = document.getElementById('sessionNoteInput');
    let chkNote = document.getElementById('chkSessionNote');
    let noteVal = noteEl ? noteEl.value.trim() : '';
    
    if (this.currentWorkflowType === 'Full Stocktake' && (!chkNote.checked || !noteVal)) {
      alert("A mandatory Session Note is required to commit a Full Stocktake (e.g., 'Q3 Inventory Audit'). Please check 'Add Session Note' and provide a reason.");
      return;
    }

    if (!confirm(`Are you sure you want to commit these quantities to the master database?\n\nMode: ${this.currentWorkflowType}\nScanned Items: ${this.scannedObjects.length}`)) return;

    let scannedTotals = {};
    this.scannedObjects.forEach(item => {
      if (!scannedTotals[item.ref]) scannedTotals[item.ref] = 0;
      scannedTotals[item.ref] += item.qty;
    });

    let varianceData = [];
    let netFinancialImpact = 0;

    DatabaseManager.db.forEach(dbItem => {
      let sku = (dbItem.sku || dbItem.ref || '').toUpperCase();
      let expected = dbItem.onHand || 0;
      let counted = scannedTotals[sku] || 0;
      
      if (this.currentWorkflowType !== 'Full Stocktake' && scannedTotals[sku] === undefined) return;

      let variance = counted - expected;
      if (variance !== 0) {
        let costStr = dbItem.cost && dbItem.cost !== "$0.00" ? dbItem.cost : (dbItem.price || "0");
        let costVal = parseFloat(costStr.replace(/[^0-9.-]+/g,"")) || 0;
        let financialVar = variance * costVal;
        netFinancialImpact += financialVar;
        
        varianceData.push({ ref: sku, desc: dbItem.desc, mfr: dbItem.mfr, expected: expected, counted: counted, variance: variance, financialImpact: financialVar });
      }
    });

    if (this.currentWorkflowType === 'Full Stocktake') {
      DatabaseManager.db.forEach(dbItem => {
        dbItem.onHand = 0;
        dbItem.reservedQty = 0; 
      });
    } else {
      Object.keys(scannedTotals).forEach(ref => {
        let dbItem = DatabaseManager.db.find(i => (i.sku || i.ref || '').toUpperCase() === ref);
        if (dbItem) dbItem.onHand = 0;
      });
    }

    Object.keys(scannedTotals).forEach(ref => {
      let dbItem = DatabaseManager.db.find(i => (i.sku || i.ref || '').toUpperCase() === ref);
      if (dbItem) {
        dbItem.onHand = (dbItem.onHand || 0) + scannedTotals[ref];
      }
    });

    localStorage.setItem('asp_wh_db', JSON.stringify(DatabaseManager.db));
    alert("Stocktake successfully committed to the master database!");
    
    if (varianceData.length > 0) {
      ReportsManager.generateVarianceReportPDF(varianceData, this.currentWorkflowType, netFinancialImpact);
    } else {
      alert("No variances detected! Your physical counts match the system perfectly.");
    }
    
    setTimeout(() => { this.completeSession(true); }, UIManager.printTimeout);
  },

  suspendToBackorder() {
    if (!confirm("Suspend session to Pending Backorder?\n\nThis will keep the session in the archive to be resumed later.")) return;
    
    this.pendingNewItems = []; this.pendingFieldUpdates = [];
    localStorage.setItem('asp_pending_new_items', JSON.stringify([])); 
    localStorage.setItem('asp_pending_updates', JSON.stringify([]));
    
    let recList = document.getElementById('manifestReconcileList');
    let recCard = document.getElementById('manifestReconcileCard');
    if (recList) recList.innerHTML = '';
    if (recCard) recCard.style.display = 'none';

    document.getElementById('sessionNoteInput').value = ""; 
    document.getElementById('chkSessionNote').checked = false;
    if (typeof UIManager !== 'undefined' && UIManager.toggleSessionNote) UIManager.toggleSessionNote();
    const chkPreload = document.getElementById('chkPreloadManifest');
    if (chkPreload) chkPreload.checked = false;

    document.getElementById('screenSummary').style.display = 'none';
    document.getElementById('screenSetup').style.display = 'block';
    
    this.isSessionActive = false; 
    this.isManifestEnabled = false;
    localStorage.setItem('asp_session_is_active', 'false'); 
    localStorage.setItem('asp_manifest_enabled', 'false');

    this.currentItemAction = 'Inventory'; // FIX

    this.saveToArchive('Pending');
  },

  saveToArchive(status = 'Pending') { 
    if (!this.sessionId || this.scannedObjects.length === 0) return null;
    
    let archive = JSON.parse(localStorage.getItem('asp_session_archive')) || [];
    let sessionObj = {
      id: this.sessionId,
      status: status,
      userName: this.currentUserName,
      sessionName: this.currentSessionName,
      orderNum: this.currentOrderNum,
      workflowType: this.currentWorkflowType,
      dateStr: this.sessionDateStr,
      startStr: this.sessionStartStr,
      manifestEnabled: this.isManifestEnabled,
      expectedManifest: this.expectedManifest,
      scannedObjects: this.scannedObjects,
      pendingNewItems: this.pendingNewItems,
      pendingUpdates: this.pendingFieldUpdates,
      lastUpdated: Date.now()
    };

    let existingIdx = archive.findIndex(s => s.id === this.sessionId);
    if (existingIdx > -1) archive[existingIdx] = sessionObj;
    else archive.unshift(sessionObj);

    let cutoff = Date.now() - 2592000000;
    archive = archive.filter(s => s.lastUpdated > cutoff);
    
    localStorage.setItem('asp_session_archive', JSON.stringify(archive));

    // Return the sealed object so completeSession can queue it in the background thread
    return sessionObj;
  },

  loadReversibleSessions() {
    let select = document.getElementById('reversalSessionSelect');
    if (!select) return;
    
    // Pull the directory directly from the Cloud Vault instead of local storage
    let archive = JSON.parse(localStorage.getItem('asp_cloud_directory')) || [];
    let cutoff = Date.now() - (24 * 60 * 60 * 1000); 
    
    let reversible = archive.filter(s => {
        if (s.status !== 'Completed') return false;
        // Parse the timestamp properly
        let sTime = parseInt(s.id, 10);
        if (isNaN(sTime) || sTime < cutoff) return false;
        
        let w = (s.workflowType || '').toUpperCase();
        if (w.includes('PACK') || w.includes('STOCKTAKE')) return false;
        return w.includes('RECEIV') || w.includes('RESERV');
    }).sort((a,b) => parseInt(b.id) - parseInt(a.id));

    select.innerHTML = '<option value="">-- Select Session to Reverse --</option>';
    reversible.forEach(s => {
        let opt = document.createElement('option');
        opt.value = s.id;
        // Highlight that it is a cloud pull
        opt.textContent = `☁️ ${s.dateStr} | ${s.sessionName} (${s.workflowType})`;
        select.appendChild(opt);
    });
  },

  async executeSessionReversal() {
    let select = document.getElementById('reversalSessionSelect');
    let targetId = select ? select.value : "";
    if (!targetId) { alert("Please select a session to reverse."); return; }

    let dir = JSON.parse(localStorage.getItem('asp_cloud_directory')) || [];
    let targetLite = dir.find(s => String(s.id) === String(targetId));
    if (!targetLite) return;

    if (!confirm(`Are you absolutely sure you want to mathematically REVERSE the session:\n\n"${targetLite.sessionName}"?\n\nThis will download the payload from the cloud and subtract all items that were originally added.`)) return;

    // Fetch the actual payload from the cloud
    let targetSession = null;
    try {
        let res = await fetch(`${this.getActiveArchiveUrl()}?action=GET_SESSION&id=${targetId}`);
        targetSession = await res.json();
        if (!targetSession || targetSession.status === "error") throw new Error("Cloud payload missing.");
    } catch(err) {
        alert("Failed to download session payload from cloud: " + err.message);
        return;
    }

    let currentAllocations = JSON.parse(localStorage.getItem('asp_allocations')) || {};
    
    // Run the negative math
    let ledgerResult = InventoryEngine.reverseLedgerMath(
        targetSession.scannedObjects,
        DatabaseManager.db,
        currentAllocations,
        targetSession.workflowType
    );

    // Save the negated database locally
    localStorage.setItem('asp_allocations', JSON.stringify(ledgerResult.updatedAllocations));
    this.syncAllocationsToCloud();
    DatabaseManager.db = ledgerResult.updatedDb;
    localStorage.setItem('asp_wh_db', JSON.stringify(DatabaseManager.db));

    // Create the new Reversal Payload for the Audit Log
    let revScannedObjects = targetSession.scannedObjects.map(item => {
        return { ...item, qty: -(item.qty), itemNote: `REVERSAL of ${targetSession.id}` };
    });

    let revSession = {
      id: Date.now().toString(),
      status: 'Completed',
      userName: this.currentUserName || 'Thomas',
      sessionName: `[REVERSED] ${targetSession.sessionName}`,
      orderNum: targetSession.orderNum,
      workflowType: targetSession.workflowType,
      dateStr: new Date().toLocaleDateString().replace(/\//g, '.'),
      startStr: new Date().toLocaleTimeString(),
      manifestEnabled: false,
      expectedManifest: [],
      scannedObjects: revScannedObjects,
      pendingNewItems: [],
      pendingUpdates: [],
      lastUpdated: Date.now()
    };

    // Push to local archive and cloud
    let localArchive = JSON.parse(localStorage.getItem('asp_session_archive')) || [];
    localArchive.unshift(revSession);
    localStorage.setItem('asp_session_archive', JSON.stringify(localArchive));
    this.pushToCloudArchive(revSession);

    // Sync the updated catalog math
    if (this.getActiveArchiveUrl()) {
      let cleanCustomers = DatabaseManager.customers.filter(c => !c.startsWith("+") && c !== "#ERROR!");
      let cleanSuppliers = DatabaseManager.suppliers.filter(s => !s.startsWith("+") && s !== "#ERROR!");
      let cleanVendors = DatabaseManager.vendors.filter(v => !v.startsWith("+") && v !== "#ERROR!");

      let dbPayload = { 
        action: "SYNC_LOCAL_DB", 
        payload: { items: DatabaseManager.db, customers: cleanCustomers, suppliers: cleanSuppliers, vendors: cleanVendors } 
      };
      fetch(this.getActiveArchiveUrl(), { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(dbPayload) }).catch(e => {});
    }

    alert("Session successfully reversed! The database and cloud audit log have been updated with the negative quantities.");
    this.loadReversibleSessions(); 
  },

  renderManifestReconciliation() {
    const card = document.getElementById('manifestReconcileCard');
    const list = document.getElementById('manifestReconcileList');
    if (!card || !list || !this.isManifestEnabled || this.expectedManifest.length === 0) return;

    let scannedMap = {};
    this.scannedObjects.forEach(i => { scannedMap[i.ref] = (scannedMap[i.ref] || 0) + i.qty; });

    let expectedMap = {};
    this.expectedManifest.forEach(exp => {
        expectedMap[exp.ref] = (expectedMap[exp.ref] || 0) + exp.expectedQty;
    });

    let hasDiscrepancy = false;
    let html = '';

    Object.keys(expectedMap).sort().forEach(ref => {
      let eQty = expectedMap[ref];
      let sQty = scannedMap[ref] || 0;
      if (sQty !== eQty) {
        hasDiscrepancy = true;
        html += `
          <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px; background:#fff; padding:8px; border:1px solid #ccc; border-radius:4px;" class="manifest-rec-row">
            <input type="text" class="rec-ref-input" value="${ref}" style="flex:2; text-transform:uppercase; font-weight:bold; color:#0277bd;" readonly>
            <input type="number" class="rec-qty-input" data-original="${eQty}" value="${eQty}" min="0" style="flex:1;">
            <span style="font-size:0.8rem; color:#555; flex:1.5;">Scanned: <strong>${sQty}</strong></span>
          </div>
        `;
      }
    });

    if (hasDiscrepancy) {
      card.style.display = 'block';
      list.innerHTML = html;
    } else {
      card.style.display = 'none';
    }
  },

  saveManifestReconciliation() {
    const list = document.getElementById('manifestReconcileList');
    if (!list) return;

    let rows = list.querySelectorAll('.manifest-rec-row');
    rows.forEach(row => {
      let ref = row.querySelector('.rec-ref-input').value.trim().toUpperCase();
      let newQty = parseInt(row.querySelector('.rec-qty-input').value, 10) || 0;
      let origQty = parseInt(row.querySelector('.rec-qty-input').getAttribute('data-original'), 10) || 0;
      
      if (newQty !== origQty) {
         let diff = newQty - origQty;
         let targetExp = this.expectedManifest.find(e => e.ref === ref);
         if (targetExp) {
             targetExp.expectedQty += diff;
             if (targetExp.expectedQty < 0) targetExp.expectedQty = 0;
         } else {
             this.expectedManifest.push({ ref: ref, expectedQty: newQty, allocations: [] });
         }
      }
    });

    this.expectedManifest = this.expectedManifest.filter(e => e.expectedQty > 0);
    localStorage.setItem('asp_active_manifest', JSON.stringify(this.expectedManifest));
    alert("Manifest updated! Recalculating session summaries...");
    this.goToSummaryScreen();
  },

  updateScannedItem(index) {
    if (!this.scannedObjects[index]) return;
    
    let qtyEl = document.getElementById(`editQty_${index}`);
    let tagEl = document.getElementById(`editTag_${index}`);
    if (!qtyEl) return;
    
    let newQty = parseInt(qtyEl.value, 10) || 1;
    let newTag = tagEl ? tagEl.value.trim() : '';

    this.scannedObjects[index].qty = newQty;
    this.scannedObjects[index].customerTag = newTag;
    if (newTag) this.scannedObjects[index].actionTag = 'Reserved';

    localStorage.setItem('asp_session_scanned_objects', JSON.stringify(this.scannedObjects));
    this.updateManifestProgressUI();
    this.saveToArchive('Pending');
    
    alert(`Updated REF ${this.scannedObjects[index].ref} (Qty: ${newQty}${newTag ? ', Tag: ' + newTag : ''})`);
    AuditManager.updateSessionSummaryView();
    this.renderManifestReconciliation();
    this.renderAdvancedReview();
  },

  deleteScannedItem(index) {
    if (!this.scannedObjects[index]) return;
    let item = this.scannedObjects[index];
    
    if (!confirm(`Delete scanned item run for REF: ${item.ref} (Lot: ${item.lot}, Qty: ${item.qty})?`)) return;

    this.scannedObjects.splice(index, 1);
    localStorage.setItem('asp_session_scanned_objects', JSON.stringify(this.scannedObjects));
    this.updateManifestProgressUI();
    this.saveToArchive('Pending');

    AuditManager.updateSessionSummaryView();
    this.renderManifestReconciliation();
    this.renderAdvancedReview();
  },

  openSettings() {
    document.getElementById('screenSetup').style.display = 'none';
    document.getElementById('screenSettings').style.display = 'block';
  },

  closeSettings() {
    document.getElementById('screenSettings').style.display = 'none';
    document.getElementById('screenSetup').style.display = 'block';
  },

  openArchive() {
    document.getElementById('screenSetup').style.display = 'none';
    document.getElementById('screenArchive').style.display = 'block';
    this.renderArchiveList();
  },

  closeArchive() {
    document.getElementById('screenArchive').style.display = 'none';
    document.getElementById('screenSetup').style.display = 'block';
  },

  renderArchiveList() {
    const container = document.getElementById('archiveListContainer');
    
    let rawList = [];
    if (this.currentArchiveTab === 'local') {
      rawList = JSON.parse(localStorage.getItem('asp_session_archive')) || [];
    } else {
      rawList = JSON.parse(localStorage.getItem('asp_cloud_directory')) || [];
    }
    
    if (rawList.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:20px; color:#555;">No ${this.currentArchiveTab} sessions found.</div>`;
      return;
    }

    let filterVal = document.getElementById('archiveFilter').value;
    // Search Input Value
    let searchVal = document.getElementById('archiveSearchInput') ? document.getElementById('archiveSearchInput').value.trim().toLowerCase() : '';
    let hideCancelled = document.getElementById('chkHideCancelled') ? document.getElementById('chkHideCancelled').checked : false;
    let onlyActive = document.getElementById('chkOnlyActive') ? document.getElementById('chkOnlyActive').checked : false;
    
    let cutoff = 0;
    if (filterVal === 'today') cutoff = Date.now() - (24 * 60 * 60 * 1000);
    else if (filterVal === 'week') cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    else if (filterVal === 'month') cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    else cutoff = 0; 

    let filtered = rawList.filter(s => {
      if (cutoff > 0 && s.lastUpdated && s.lastUpdated < cutoff) return false;
      if (hideCancelled && s.status === 'Cancelled') return false;
      if (onlyActive && s.status !== 'Pending') return false; 
      
      // Apply the text search filter
      if (searchVal) {
          let searchTarget = `${s.sessionName} ${s.orderNum} ${s.dateStr} ${s.id}`.toLowerCase();
          if (!searchTarget.includes(searchVal)) return false;
      }
      
      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:20px; color:#555;">No sessions found matching these filters.</div>`;
      return;
    }

    let html = '';
    filtered.forEach(s => {
      let statusColor = s.status === 'Completed' ? '#2e7d32' : (s.status === 'Cancelled' ? '#d32f2f' : (s.status === 'Pending' ? '#0277bd' : '#f57f17'));
      
      let itemsPreview = '';
      let isCloud = s.isCloud === true;

      if (!isCloud && s.scannedObjects) {
        itemsPreview = s.scannedObjects.map(item => `<li>${item.qty}x ${item.ref}</li>`).join('');
        if(!itemsPreview) itemsPreview = '<li>No items scanned</li>';
      } else {
        itemsPreview = '<li style="color:#0277bd; font-style:italic;">Payload stored safely in Cloud Vault. Restore to view items.</li>';
      }

      let deleteBtnHtml = isCloud 
        ? `<div style="font-size:0.8rem; color:#777; font-style:italic;">Locked (Cloud)</div>` 
        : `<button class="btn-small btn-cancel btn-auto" onclick="SessionManager.deleteArchivedSession('${s.id}')">🗑️ Delete</button>`;

      let restoreBtnHtml = isCloud
        ? `<button class="btn-action btn-auto" style="margin:0; padding:6px 12px; background-color:#1565c0; color:#fff;" onclick="SessionManager.restoreArchivedSession('${s.id}', true)">☁️ Download & Restore</button>`
        : `<button class="btn-action btn-save btn-auto" style="margin:0; padding:6px 12px;" onclick="SessionManager.restoreArchivedSession('${s.id}', false)">🔄 Restore Local</button>`;

      html += `
        <div class="audit-card" style="border-left: 5px solid ${statusColor};">
          <div class="flex-between" style="margin-bottom: 6px;">
            <strong style="color:#0277bd; font-size:1.05rem;">${s.sessionName}</strong>
            <span class="badge-info" style="background-color:${statusColor}; color:#fff;">${s.status}</span>
          </div>
          
          <details style="font-size: 0.85rem; color: #555; margin-bottom: 10px;">
            <summary style="cursor:pointer; font-weight:bold; color:#333; margin-bottom:6px;">[+] View Details</summary>
            <div style="padding-left: 12px; margin-top: 6px; border-left: 2px solid #eee;">
              <div><strong>Date:</strong> ${s.dateStr} | <strong>User:</strong> ${s.userName}</div>
              ${s.workflowType ? `<div><strong>Workflow:</strong> ${s.workflowType}</div>` : ''}
              <div style="margin-top:6px;"><strong>Items:</strong></div>
              <ul style="margin:4px 0 0 0; padding-left:16px; max-height:80px; overflow-y:auto;">
                ${itemsPreview}
              </ul>
            </div>
          </details>
          
          <div class="flex-between">
            ${deleteBtnHtml}
            ${restoreBtnHtml}
          </div>
        </div>
      `;
    });
    container.innerHTML = html;
  },

  async restoreArchivedSession(id, isCloud = false) {
    let confirmMsg = isCloud 
      ? "Download and restore this session from the Cloud Vault?\n\nThis will override your current unsaved session if you have one active." 
      : "Restore this local session?\n\nThis will override your current unsaved session if you have one active.";
    
    if (!confirm(confirmMsg)) return;
    
    let sessionData = null;

    if (isCloud) {
      try {
        let dir = JSON.parse(localStorage.getItem('asp_cloud_directory')) || [];
        let targetLite = dir.find(s => String(s.id) === String(id));
        if (!targetLite) return;

        let partsToFetch = [targetLite];
        let baseName = targetLite.sessionName;

        // Auto-detect if this is part of a split session
        let match = targetLite.sessionName.match(/(.*?)\s*\(Part \d+ of \d+\)$/i);
        if (match) {
          baseName = match[1].trim();
          partsToFetch = dir.filter(s => {
              let smatch = s.sessionName.match(/(.*?)\s*\(Part \d+ of \d+\)$/i);
              let sBase = smatch ? smatch[1].trim() : s.sessionName;
              return sBase === baseName && s.dateStr === targetLite.dateStr;
          }).sort((a, b) => parseInt(a.id) - parseInt(b.id));
        }

        let overlay = document.createElement('div');
        overlay.id = 'downloadOverlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:99999; display:flex; justify-content:center; align-items:center; color:#fff; font-size:1.2rem; font-weight:bold; flex-direction:column;';
        overlay.innerHTML = `<div style="font-size:2rem; margin-bottom:10px;">☁️</div><div id="dlText">Downloading session payload...</div>`;
        document.body.appendChild(overlay);

        let combinedScans = [];
        for (let i = 0; i < partsToFetch.length; i++) {
          let partLite = partsToFetch[i];
          let dlText = document.getElementById('dlText');
          if (dlText && partsToFetch.length > 1) dlText.textContent = `Downloading part ${i+1} of ${partsToFetch.length}...`;

          let res = await fetch(`${this.getActiveArchiveUrl()}?action=GET_SESSION&id=${partLite.id}`);
          let partData = await res.json();
          
          if (!partData || partData.status === "error") {
            document.body.removeChild(overlay);
            alert("Failed to download payload: " + (partData ? partData.message : "Unknown error"));
            return;
          }
          if (i === 0) sessionData = partData;
          combinedScans = combinedScans.concat(partData.scannedObjects || []);
        }
        document.body.removeChild(overlay);

        if (partsToFetch.length > 1) {
          sessionData.scannedObjects = combinedScans;
          sessionData.sessionName = baseName;
          if (sessionData.workflowType === 'Selection Stocktake' && baseName.toUpperCase().includes('FULL-INV')) {
             sessionData.workflowType = 'Full Stocktake';
          }
        }

      } catch (err) {
        let overlay = document.getElementById('downloadOverlay');
        if (overlay) document.body.removeChild(overlay);
        alert("Network error downloading session: " + err.message);
        return;
      }
    } else {
      let archive = JSON.parse(localStorage.getItem('asp_session_archive')) || [];
      sessionData = archive.find(x => x.id === id);
    }

    if (!sessionData) {
      alert("Session data could not be found.");
      return;
    }

    this.sessionId = sessionData.id;
    this.isSessionActive = true;
    this.currentUserName = sessionData.userName;
    this.currentSessionName = sessionData.sessionName;
    this.currentOrderNum = sessionData.orderNum;
    this.currentWorkflowType = sessionData.workflowType;
    this.sessionDateStr = sessionData.dateStr;
    this.sessionStartStr = sessionData.startStr;
    
    if (this.sessionStartStr === 'Historical Import') {
      this.sessionStartStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    this.isManifestEnabled = sessionData.manifestEnabled;
    this.expectedManifest = sessionData.expectedManifest || [];
    this.scannedObjects = sessionData.scannedObjects || [];
    this.pendingNewItems = sessionData.pendingNewItems || [];
    this.pendingFieldUpdates = sessionData.pendingUpdates || [];

    // --- NEW UI REBUILD & STATE OVERRIDE ---
    let destRow = document.getElementById('rowItemDestination');
    let tagRow = document.getElementById('rowCustomerTag');

    if (this.currentWorkflowType.includes('Receiving & Reserving')) {
      this.currentItemAction = 'Inventory'; 
      if (destRow) destRow.style.display = 'flex';
      if (tagRow) tagRow.style.display = 'none';
      if (typeof UIManager !== 'undefined' && UIManager.setItemAction) UIManager.setItemAction('Inventory');
    } else if (this.currentWorkflowType.includes('Reserving')) {
      this.currentItemAction = 'Reserved';
      if (destRow) destRow.style.display = 'none';
      if (tagRow) tagRow.style.display = 'none';
    } else if (this.currentWorkflowType.includes('Packing')) {
      this.currentItemAction = 'Pack & Ship';
      if (destRow) destRow.style.display = 'none';
      if (tagRow) tagRow.style.display = 'none';
    } else {
      this.currentItemAction = 'Inventory';
      if (destRow) destRow.style.display = 'none';
      if (tagRow) tagRow.style.display = 'none';
    }
    // ----------------------------------------

    localStorage.setItem('asp_session_id', this.sessionId);
    localStorage.setItem('asp_session_is_active', 'true');
    localStorage.setItem('asp_user_name', this.currentUserName);
    localStorage.setItem('asp_session_name', this.currentSessionName);
    localStorage.setItem('asp_order_num', this.currentOrderNum);
    localStorage.setItem('asp_workflow_type', this.currentWorkflowType);
    localStorage.setItem('asp_session_date_str', this.sessionDateStr);
    localStorage.setItem('asp_session_start_str', this.sessionStartStr);
    localStorage.setItem('asp_manifest_enabled', this.isManifestEnabled ? 'true' : 'false');
    localStorage.setItem('asp_active_manifest', JSON.stringify(this.expectedManifest));
    localStorage.setItem('asp_session_scanned_objects', JSON.stringify(this.scannedObjects));
    localStorage.setItem('asp_pending_new_items', JSON.stringify(this.pendingNewItems));
    localStorage.setItem('asp_pending_updates', JSON.stringify(this.pendingFieldUpdates));

    this.updateHeaderBanners();
    document.getElementById('screenArchive').style.display = 'none';
    this.goToSummaryScreen();
  },

  deleteArchivedSession(id) {
    if (!confirm("Are you sure you want to permanently delete this session from the archive?")) return;
    let archive = JSON.parse(localStorage.getItem('asp_session_archive')) || [];
    archive = archive.filter(s => s.id !== id);
    localStorage.setItem('asp_session_archive', JSON.stringify(archive));
    this.renderArchiveList();
  },

  async pushQboWriteBack(sessionObj) {
    if (!this.getActiveFeederUrl() || this.getActiveFeederUrl().includes("YOUR_")) return; 
    
    if (!sessionObj.workflowType.includes('Packing') || !sessionObj.orderNum) return;
    
    let payload = {
      action: "QBO_WRITEBACK",
      payload: sessionObj
    };

    try {
      await fetch(this.getActiveFeederUrl(), { 
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.warn("Background QBO Write-back failed:", err);
    }
  },

  bindOrderInputListener() {
    let orderInput = document.getElementById('orderDetailsInput');
    if (orderInput) {
      orderInput.addEventListener('change', (e) => {
        let val = e.target.value.trim().toUpperCase();
        if (!val) return;
        
        // STRICT CHECK: Only trigger for Orders that are Picking & Packing
        let typeRadio = document.querySelector('input[name="sessionType"]:checked');
        let wType = document.getElementById('workflowTypeSelect').value;
        if (!typeRadio || typeRadio.value !== 'Order' || wType !== 'Picking & Packing') return;
        
        let match = Object.keys(this.fetchedStagedData).find(key => key.toUpperCase().includes(val));
        
        if (match) {
          let isDone = this.fetchedStagedData[match].isCompleted === true;
          if (isDone) return; 

          UIManager.showCustomConfirm(
            "Order Found",
            `📦 Order ${val} found in the QBO Feed!\n\nWould you like to auto-fill the customer and pre-load the expected items for packing?`,
            () => {
              let customerName = match.split('-')[0].trim();
              let custSelect = document.getElementById('customerSelect');
              if (custSelect) {
                 let opt = Array.from(custSelect.options).find(o => o.value.toUpperCase() === customerName.toUpperCase());
                 if (opt) custSelect.value = opt.value;
              }
              document.getElementById('chkPreloadManifest').checked = true;
              this.loadSelectedStagedOrder(match);
            }
          );
        }
      });
    }
  }
};