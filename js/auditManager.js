/* =======================================================================
 * Allied Surgical Products - Inventory Management System
 * File: js/auditManager.js
 * Author: Thomas Seyfors
 * Date Created: August 2026
 * 
 * Description:
 *   Audit, report generation, and traceability engine. Constructs TXT and
 *   printable HTML/PDF session summaries, calculates live session metrics,
 *   parses multi-log uploads, and executes the Event Replay System Restore.
 *
 * Affected Features:
 *   - Session Summary Output (PDF & TXT)
 *   - End of Week & Daily Internal Sales Reports
 *   - Thrive & Shopify CSV Exports
 *   - Cloud Traceability & FEFO Lot Tracking
 *   - Cloud Event Replay (System Restore Tool)
 *
 * Copyright (c) 2026 Thomas Seyfors / Allied Surgical Products.
 * All Rights Reserved.
 * ======================================================================= */
const AuditManager = {
  parsedAuditSessions: [],

  cleanGtinValue(val) {
    if (!val) return 'N/A';
    return val.replace(/^\][a-zA-Z0-9]{2}/, '').replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim() || 'N/A';
  },

  loadCloudSessionsForExport() {
    let select = document.getElementById('cloudExportSessionSelect');
    if (!select) return;

    let archive = JSON.parse(localStorage.getItem('asp_cloud_directory')) || [];
    let completed = archive.filter(s => s.status === 'Completed').sort((a,b) => parseInt(b.id) - parseInt(a.id));

    select.innerHTML = '<option value="">-- Select an Archived Session --</option>';
    completed.forEach(s => {
        let opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.dateStr} | ${s.sessionName} (${s.workflowType})`;
        select.appendChild(opt);
    });
  },

  async exportCloudSessionData() {
    let select = document.getElementById('cloudExportSessionSelect');
    let format = document.getElementById('cloudExportFormat').value;
    let sessionId = select ? select.value : "";
    
    if (!sessionId) {
      alert("Please select a session from the dropdown.");
      return;
    }

    let btn = document.getElementById('btnExportCloudSession');
    let origText = btn.textContent;
    btn.textContent = "⏳ Fetching...";
    btn.disabled = true;

    try {
      // ✨ FIX: encodeURIComponent safely packages special characters (like # or spaces) for web travel
      let res = await fetch(`${SessionManager.getActiveArchiveUrl()}?action=GET_SESSION&id=${encodeURIComponent(sessionId)}`);
      let rawText = await res.text();
      
      // ✨ FIX: Intercept HTML error pages before JSON.parse crashes
      if (rawText.trim().startsWith('<')) {
          throw new Error("Google returned an HTML error page. The session ID may be malformed or the payload is too large.");
      }
      
      let sessionData = JSON.parse(rawText);

      if (!sessionData || sessionData.status === "error") {
        throw new Error(sessionData.message || "Could not download session payload from the cloud.");
      }

      // Temporarily mock SessionManager state
      let tempState = {
        scannedObjects: SessionManager.scannedObjects,
        currentSessionName: SessionManager.currentSessionName,
        currentOrderNum: SessionManager.currentOrderNum,
        currentWorkflowType: SessionManager.currentWorkflowType,
        sessionDateStr: SessionManager.sessionDateStr,
        sessionStartStr: SessionManager.sessionStartStr,
        currentUserName: SessionManager.currentUserName,
        isManifestEnabled: SessionManager.isManifestEnabled,
        expectedManifest: SessionManager.expectedManifest,
        pendingNewItems: SessionManager.pendingNewItems,
        pendingFieldUpdates: SessionManager.pendingFieldUpdates
      };

      // Override with cloud data
      SessionManager.scannedObjects = sessionData.scannedObjects || [];
      SessionManager.currentSessionName = sessionData.sessionName || "Archived Session";
      SessionManager.currentOrderNum = sessionData.orderNum || "";
      SessionManager.currentWorkflowType = sessionData.workflowType || "General";
      SessionManager.sessionDateStr = sessionData.dateStr || "";
      SessionManager.sessionStartStr = sessionData.startStr || "";
      SessionManager.currentUserName = sessionData.userName || "";
      SessionManager.isManifestEnabled = sessionData.manifestEnabled || false;
      SessionManager.expectedManifest = sessionData.expectedManifest || [];
      SessionManager.pendingNewItems = sessionData.pendingNewItems || [];
      SessionManager.pendingFieldUpdates = sessionData.pendingUpdates || [];

      // Run the export generator
      await this.exportSessionData(format);

      // Restore the local state immediately
      Object.assign(SessionManager, tempState);

    } catch(err) {
      alert("Export failed: " + err.message);
    } finally {
      btn.textContent = origText;
      btn.disabled = false;
    }
  },

  updateSessionSummaryView() {
    let container = document.getElementById('summaryListContainer');
    let elUnique = document.getElementById('sumUniqueRefs');
    let elTotal = document.getElementById('sumTotalQty');
    if (!container) return; container.innerHTML = '';

    if (SessionManager.scannedObjects.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding: 14px; color: #555;">No items scanned in this session yet.</div>';
      if(elUnique) elUnique.textContent = '0'; if(elTotal) elTotal.textContent = '0'; return;
    }

    let totalQty = 0; let uniqueRefs = new Set();
    let isTagWorkflow = !SessionManager.currentWorkflowType.includes('Stocktake') && !SessionManager.currentWorkflowType.includes('Packing');

    let grouped = {};
    SessionManager.scannedObjects.forEach((item, index) => {
      totalQty += item.qty; uniqueRefs.add(item.ref);
      if (!grouped[item.ref]) grouped[item.ref] = { total: 0, scans: [] };
      grouped[item.ref].total += item.qty;
      grouped[item.ref].scans.push({ ...item, originalIndex: index });
    });

    Object.keys(grouped).forEach((ref, gIndex) => {
      let group = grouped[ref];
      let details = document.createElement('details');
      details.className = 'summary-item-card';
      let summary = document.createElement('summary');
      summary.innerHTML = `<span style="color:#0277bd;">[+] ${gIndex + 1}. REF: ${ref}</span> <span style="font-weight:bold;">Total Qty: ${group.total}</span>`;
      details.appendChild(summary);

      let content = document.createElement('div');
      content.style.paddingTop = '10px'; content.style.marginTop = '10px'; content.style.borderTop = '1px solid #eee'; content.style.fontSize = '0.85rem';

      group.scans.forEach(scan => {
        let statusIcon = scan.actionTag === 'Reserved' ? '🚩' : (scan.actionTag === 'Pack & Ship' ? '🖐️' : '📦');
        let noteHtml = scan.itemNote ? `<div style="font-size:0.8rem; color:#d32f2f; margin-top:6px;"><em>Note: ${scan.itemNote}</em></div>` : '';
        let tagHtml = isTagWorkflow ? `<label style="font-weight:bold; font-size:0.8rem; margin-left:6px;">Tag:</label><input type="text" id="editTag_${scan.originalIndex}" value="${scan.customerTag || ''}" style="flex:1; padding:4px; text-transform:uppercase;">` : `<input type="hidden" id="editTag_${scan.originalIndex}" value="">`;

        content.innerHTML += `
          <div style="background:#f5f5f5; border:1px solid #e0e0e0; border-radius:4px; padding:8px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
              <span><strong>Lot:</strong> ${scan.lot}</span><span><strong>Exp:</strong> ${scan.exp}</span><span>${statusIcon} ${scan.actionTag}</span>
            </div>
            ${noteHtml}
            <div style="display:flex; gap:6px; align-items:center; margin-top:6px;">
              <label style="font-weight:bold; font-size:0.8rem;">Qty:</label>
              <input type="number" id="editQty_${scan.originalIndex}" value="${scan.qty}" min="0" style="width:60px; padding:4px; text-align:center;">
              ${tagHtml}
            </div>
            <div class="flex-between" style="margin-top:6px;">
              <button class="btn-small btn-cancel btn-auto" style="padding:3px 8px;" onclick="SessionManager.deleteScannedItem(${scan.originalIndex})">🗑️ Delete</button>
              <button class="btn-small btn-save btn-auto" style="padding:3px 12px; background-color:#1976d2;" onclick="SessionManager.updateScannedItem(${scan.originalIndex})">💾 Save</button>
            </div>
          </div>
        `;
      });
      details.appendChild(content); container.appendChild(details);
    });

    if(elUnique) elUnique.textContent = uniqueRefs.size; if(elTotal) elTotal.textContent = totalQty;
  },

  cloudTraceData: null,

  async fetchAndCompileTraceability() {
    let timeframe = document.getElementById('traceTimeframe').value;
    let btn = document.getElementById('btnGenerateTrace');
    let origText = btn.textContent;
    btn.textContent = "⏳ Fetching Cloud Ledger..."; 
    btn.disabled = true;

    // NEW: Force the screen to switch to the Audit Hub so the user can see it
    document.getElementById('screenDevTools').style.display = 'none';
    document.getElementById('screenAuditHub').style.display = 'block';

    document.getElementById('auditResultsContainer').style.display = 'block';
    document.getElementById('auditPreviewContent').innerHTML = '<div style="text-align:center; padding:20px; color:#0277bd; font-weight:bold;">⏳ Processing live ledger from the cloud... Please wait.</div>';
    
    try {
      let res = await fetch(`${SessionManager.cloudArchiveUrl}?action=GET_AUDIT_LOG&t=${Date.now()}`);
      let text = await res.text();
      let responseData = JSON.parse(text);
      if (responseData.status !== "success" || !responseData.data) throw new Error("Failed to load audit log.");

      let auditLog = responseData.data;

      // Filter by timeframe
      let cutoffDate = new Date();
      if (timeframe === '24h') cutoffDate.setDate(cutoffDate.getDate() - 1);
      else if (timeframe === '7d') cutoffDate.setDate(cutoffDate.getDate() - 7);
      else if (timeframe === '30d') cutoffDate.setDate(cutoffDate.getDate() - 30);
      else if (timeframe === '90d') cutoffDate.setDate(cutoffDate.getDate() - 90);
      else cutoffDate = new Date(2000, 0, 1); // all time

      let filteredLogs = auditLog.filter(row => {
        let rowDate = new Date(row['Timestamp']);
        return rowDate >= cutoffDate;
      });

      let lotTraceMap = {};
      let totalItemsScanned = 0;
      let uniqueRefs = new Set();
      let datesArray = [];

      filteredLogs.forEach(row => {
        let ref = row['REF / SKU'];
        let lot = row['Lot'];
        let exp = row['Exp Date'];
        let qty = parseInt(row['Qty Moved'], 10) || 0;
        let workflow = row['Workflow'] || '';
        let dest = row['Destination / Action'] || '';
        let sessionName = row['Session / Reason'] || '';
        let user = row['User'] || '';
        let rawDate = row['Timestamp'] || '';
        
        if (!ref || !lot || lot === 'N/A') return;

        uniqueRefs.add(ref);
        totalItemsScanned += qty;
        
        let dateOnly = rawDate.split(' ')[0];
        if (dateOnly && !datesArray.includes(dateOnly)) datesArray.push(dateOnly);

        let key = `${ref}_${lot}`;
        if (!lotTraceMap[key]) {
          let match = (typeof DatabaseManager !== 'undefined' && DatabaseManager.db) ? DatabaseManager.db.find(i => (i.sku || i.ref || '').toUpperCase() === ref.toUpperCase()) : null;
          lotTraceMap[key] = {
            ref: ref, lot: lot, exp: exp,
            desc: match ? (match.desc || '') : '',
            mfr: match ? (match.mfr || '') : '',
            gtin: match ? (match.gtin || 'N/A') : 'N/A',
            price: match ? (match.price || '$0.00') : '$0.00',
            inboundQty: 0, reservedQty: 0, outboundQty: 0, damagedQty: 0,
            receivedDate: 'N/A', reservedForTag: '', timeline: []
          };
        }

        let customerTag = '';
        if (dest.includes('Reserved for:')) {
           customerTag = dest.replace('Reserved for:', '').trim();
        } else if (workflow.includes('Pack') && dest && dest !== 'Pack & Ship') {
           customerTag = dest;
        }

        if (dest.toLowerCase().includes('damage') || dest.toLowerCase().includes('note:')) {
          lotTraceMap[key].damagedQty += qty;
        }

        if (workflow.includes('Receiving') || workflow.includes('Stocktake')) {
          lotTraceMap[key].inboundQty += qty;
          if (lotTraceMap[key].receivedDate === 'N/A') lotTraceMap[key].receivedDate = dateOnly;
        }
        if (workflow.includes('Reserving')) {
          lotTraceMap[key].reservedQty += qty;
          if (customerTag) lotTraceMap[key].reservedForTag = customerTag;
        }
        if (workflow.includes('Packing') || workflow.includes('Pack & Ship')) {
          lotTraceMap[key].outboundQty += qty;
        }

        lotTraceMap[key].timeline.push({
          date: rawDate, workflow: workflow, qty: qty, sessionName: sessionName, fileName: 'Cloud Ledger', customerTag: customerTag, itemNote: dest, user: user
        });
      });

      datesArray.sort((a,b) => new Date(a) - new Date(b));
      let startDate = datesArray.length > 0 ? datesArray[0] : new Date().toLocaleDateString();
      let endDate = datesArray.length > 0 ? datesArray[datesArray.length - 1] : new Date().toLocaleDateString();
      
      let sortedTraceList = Object.values(lotTraceMap).sort((a, b) => { 
        if (a.ref < b.ref) return -1; if (a.ref > b.ref) return 1; 
        if (a.lot < b.lot) return -1; if (a.lot > b.lot) return 1; 
        return 0; 
      });
      
      // Cache the result for exports
      this.cloudTraceData = { sortedTraceList, totalItemsScanned, uniqueRefsCount: uniqueRefs.size, startDate, endDate, sourceFilesList: ["Master Cloud Audit Ledger"] };

      this.renderAuditPreviewUI();

    } catch (err) {
      alert("Error generating traceability report: " + err.message);
      document.getElementById('auditPreviewContent').innerHTML = '';
    } finally {
      btn.textContent = origText; btn.disabled = false;
    }
  }, 

  loadCustomerReportData() {
    let select = document.getElementById('customerReportSelect');
    let controls = document.getElementById('customerReportControls');
    let title = document.getElementById('selectedCustomerTitle');
    
    if (!select || !select.value) {
      alert("Please select a valid customer account from the dropdown first.");
      if (controls) controls.style.display = 'none';
      return;
    }

    let cust = select.value;
    if (title) title.textContent = `Account Selected: ${cust}`;
    if (controls) controls.style.display = 'flex';
  },

  async fetchBugReports(event) {
    let btn = event.target;
    let origText = btn.innerHTML;
    btn.innerHTML = "⏳ Fetching...";
    btn.disabled = true;

    try {
      let res = await fetch(`${SessionManager.cloudArchiveUrl}?action=GET_BUG_REPORTS&t=${Date.now()}`);
      let data = await res.json();
      
      if (data.status !== "success") throw new Error("Failed to fetch reports.");
      
      let reports = data.reports || [];
      if (reports.length === 0) {
        UIManager.showCustomAlert("Bug Reports", "No bug reports found in the database.");
        return;
      }

      let rows = reports.map(r => `
        <div style="background:#f9f9f9; border:1px solid #ccc; padding:10px; margin-bottom:10px; border-radius:4px; text-align:left;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:0.8rem; color:#555;">
            <strong>${r.timestamp}</strong> <span>Env: ${r.env} | v${r.version}</span>
          </div>
          <div style="font-size:0.85rem; margin-bottom:6px;">
            <strong>User:</strong> ${r.user}<br>
            <strong>Session:</strong> ${r.session} (${r.workflow})
          </div>
          <div style="background:#fff; border-left:3px solid #c62828; padding:8px; font-family:monospace; font-size:0.85rem; color:#c62828; white-space:pre-wrap;">${r.desc}</div>
        </div>
      `).join('');

      let modal = document.createElement('div');
      modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:999999; display:flex; justify-content:center; align-items:center; padding:15px; box-sizing:border-box;';
      modal.innerHTML = `
        <div style="background:#fff; border-radius:8px; width:100%; max-width:600px; max-height:85vh; padding:20px; display:flex; flex-direction:column;">
          <h3 style="margin:0 0 15px 0; color:#c62828; border-bottom:2px solid #c62828; padding-bottom:8px;">🐞 System Bug Reports</h3>
          <div style="overflow-y:auto; flex:1; padding-right:5px;">
            ${rows}
          </div>
          <button onclick="this.parentElement.parentElement.remove()" style="background:#757575; color:#fff; border:none; padding:10px; border-radius:4px; font-weight:bold; cursor:pointer; margin-top:15px; width:100%;">Close Viewer</button>
        </div>`;
      document.body.appendChild(modal);

    } catch (err) {
      UIManager.showCustomAlert("Error", "Could not load bug reports: " + err.message);
    } finally {
      btn.innerHTML = origText;
      btn.disabled = false;
    }
  },

  executeSessionAction() {
    const val = document.getElementById('exportDropdown').value;
    if (!val) {
      alert("Please select an action from the dropdown first.");
      return;
    }

    if (val === 'continue') {
      ScannerManager.resetScanLinesAndFields();
      document.getElementById('screenSummary').style.display = 'none';
      document.getElementById('screenScanning').style.display = 'block';
    } else if (val === 'commit_stock') {
      SessionManager.commitStocktake();
    } else if (val === 'cancel') {
      SessionManager.cancelSession();
    } else if (val === 'complete') {
      SessionManager.completeSession();
    } else if (val === 'backorder') {
      SessionManager.suspendToBackorder();
    } else if (val === 'exit_restored') {
      document.getElementById('screenSummary').style.display = 'none';
      document.getElementById('screenSetup').style.display = 'block';
      SessionManager.isSessionActive = false;
      return;
    } else if (val === 'pdf' || val === 'txt') {
      this.exportSessionData(val);
    }

    setTimeout(() => { document.getElementById('exportDropdown').value = "continue"; }, UIManager.printTimeout);
  },

  // ==========================================================================
  // SINGLE SESSION REPORT BUILDERS (TXT & PDF)
  // ==========================================================================

  buildTXTReportString() {
    let mfrMap = {};
    let custMap = {};
    let unpricedMfrMap = {};
    let scannedMap = {}; 

    SessionManager.scannedObjects.forEach(item => {
      let mfr = item.mfr || 'UNKNOWN MANUFACTURER';
      let rKey = item.ref;
      let cleanGtin = this.cleanGtinValue(item.gtin);
      
      if (!mfrMap[mfr]) mfrMap[mfr] = {};
      if (!mfrMap[mfr][rKey]) {
        mfrMap[mfr][rKey] = { ref: rKey, desc: item.desc, price: item.price, totalScannedQty: 0, byTag: {} };
      }
      mfrMap[mfr][rKey].totalScannedQty += item.qty;

      let tKey = item.customerTag || 'UNTAGGED';
      if (!mfrMap[mfr][rKey].byTag[tKey]) mfrMap[mfr][rKey].byTag[tKey] = { tagTotalQty: 0, lots: {} };
      mfrMap[mfr][rKey].byTag[tKey].tagTotalQty += item.qty;

      let lotKey = `${item.lot}_${item.exp}`;
      if (!mfrMap[mfr][rKey].byTag[tKey].lots[lotKey]) {
        mfrMap[mfr][rKey].byTag[tKey].lots[lotKey] = { lot: item.lot, exp: item.exp, qty: 0, notes: [] };
      }
      mfrMap[mfr][rKey].byTag[tKey].lots[lotKey].qty += item.qty;
      if (item.itemNote) mfrMap[mfr][rKey].byTag[tKey].lots[lotKey].notes.push(item.itemNote);

      if (item.customerTag) {
        if (!custMap[item.customerTag]) custMap[item.customerTag] = {};
        if (!custMap[item.customerTag][rKey]) custMap[item.customerTag][rKey] = 0;
        custMap[item.customerTag][rKey] += item.qty;
      }

      if (!item.price || item.price === "$0.00" || item.price === "0") {
         if (!unpricedMfrMap[mfr]) unpricedMfrMap[mfr] = new Set();
         unpricedMfrMap[mfr].add(rKey);
      }

      if (!scannedMap[rKey]) scannedMap[rKey] = { totalScannedQty: 0 };
      scannedMap[rKey].totalScannedQty += item.qty;
    });

    let sessionTitleHeader = SessionManager.currentSessionName;
    if (SessionManager.currentOrderNum && !sessionTitleHeader.includes(SessionManager.currentOrderNum)) {
      sessionTitleHeader += ` (${SessionManager.currentOrderNum})`;
    }

    const nowObj = new Date();
    let timeEndStr = nowObj.toLocaleTimeString();
    let totalUniqueRefs = new Set(SessionManager.scannedObjects.map(i => i.ref)).size;
    let totalItemsScanned = SessionManager.scannedObjects.reduce((acc, curr) => acc + (parseInt(curr.qty, 10) || 0), 0);
    let sNote = document.getElementById('sessionNoteInput') ? document.getElementById('sessionNoteInput').value.trim() : '';

    let reportLines = [
      `================================================================================`,
      `ASP Inventory Management System Summary Export - ${sessionTitleHeader}`,
      ``,
      `          Scanned By:          ${SessionManager.currentUserName || 'N/A'}`,
      `          Total Unique REFs:   ${totalUniqueRefs}`,
      `          Total Items Scanned: ${totalItemsScanned}`,
      ``,
      `          Workflow Process:    ${SessionManager.currentWorkflowType}`,
      `          Scanned Date:        ${SessionManager.sessionDateStr}`,
      `          Session Start:       ${SessionManager.sessionStartStr || 'N/A'}`,
      `          Session End:         ${timeEndStr}`
    ];
    
    if (sNote) reportLines.push(`          Session Notes:       ${sNote}`);
    reportLines.push(`================================================================================\n`);

    if (Object.keys(custMap).length > 0) {
      reportLines.push(`--- ROUTED TO CUSTOMER BINS ---`);
      Object.keys(custMap).sort().forEach(cTag => {
         reportLines.push(`  * Customer: ${cTag}`);
         Object.keys(custMap[cTag]).sort().forEach(ref => {
             reportLines.push(`      - REF: ${ref} | Qty: ${custMap[cTag][ref]}`);
         });
      });
      reportLines.push(``);
    }

    if (SessionManager.isManifestEnabled && SessionManager.expectedManifest.length > 0) {
      let shortages = [];
      SessionManager.expectedManifest.forEach(exp => {
        let scannedObj = scannedMap[exp.ref];
        let scannedQty = scannedObj ? scannedObj.totalScannedQty : 0;
        if (scannedQty < exp.expectedQty) {
          shortages.push({ ref: exp.ref, expected: exp.expectedQty, scanned: scannedQty, shortQty: exp.expectedQty - scannedQty });
        }
      });

      if (shortages.length > 0) {
        reportLines.push(`--- SHORTAGES / MISSING ITEMS ---`);
        shortages.forEach(s => {
          reportLines.push(`  * REF: ${s.ref} | Expected: ${s.expected} | Scanned: ${s.scanned} | SHORT: ${s.shortQty}`);
        });
        reportLines.push(``);
      }
    }

    if (SessionManager.isManifestEnabled && SessionManager.expectedManifest.length > 0) {
      let overages = [];
      Object.keys(scannedMap).forEach(rKey => {
        let expObj = SessionManager.expectedManifest.find(e => e.ref === rKey);
        let expQty = expObj ? expObj.expectedQty : 0;
        let scannedQty = scannedMap[rKey].totalScannedQty;
        if (scannedQty > expQty) {
          overages.push({ ref: rKey, expected: expQty, scanned: scannedQty, overQty: scannedQty - expQty });
        }
      });

      if (overages.length > 0) {
        reportLines.push(`--- OVERAGES / UNEXPECTED ITEMS ---`);
        overages.forEach(o => {
          reportLines.push(`  * REF: ${o.ref} | Expected: ${o.expected} | Scanned: ${o.scanned} | OVER: +${o.overQty}`);
        });
        reportLines.push(``);
      }
    }

    reportLines.push(`--- SCANNED ITEM DETAILS BREAKDOWN ---\n`);

    let sortedMfrs = Object.keys(mfrMap).sort();
    sortedMfrs.forEach(mfr => {
      reportLines.push(`### MANUFACTURER: ${mfr} ###\n`);
      
      let sortedRefs = Object.keys(mfrMap[mfr]).sort();
      sortedRefs.forEach(rKey => {
        let rData = mfrMap[mfr][rKey];
        let descLine = (rData.desc && rData.desc !== "Navigate to vendor website for item description.") ? `    | Description: ${rData.desc}\n` : '';
        
        reportLines.push(`[+] REF: ${rData.ref}\n${descLine}    | Total Quantity: ${rData.totalScannedQty}`);
        
        for (let tKey in rData.byTag) {
          let tagData = rData.byTag[tKey];
          if (tKey !== 'UNTAGGED') reportLines.push(`    | Customer Tag: ${tKey} (Qty: ${tagData.tagTotalQty})`);
          reportLines.push(`    | Lot & Expiration Breakdowns:`);
          for (let lKey in tagData.lots) {
            let lData = tagData.lots[lKey];
            reportLines.push(`      - Lot: ${lData.lot} | Exp: ${lData.exp} | Qty: ${lData.qty}`);
            if(lData.notes.length > 0) reportLines.push(`        * Notes: ${lData.notes.join(', ')}`);
          }
        }
        reportLines.push(``); 
      });
    });

    if (SessionManager.currentWorkflowType.includes('Receiving') && Object.keys(unpricedMfrMap).length > 0) {
      reportLines.push(`--- ITEMS REQUIRING PRICING ---`);
      Object.keys(unpricedMfrMap).sort().forEach(mfr => {
        let refList = Array.from(unpricedMfrMap[mfr]).sort().join(', ');
        reportLines.push(`  * MFR: ${mfr} -> REFs: ${refList}`);
      });
      reportLines.push(``);
    }

    if (SessionManager.pendingNewItems.length > 0) {
      reportLines.push(`--------------------------------------------------------------------------------\n--- NEW ITEM DETAILS ---\n--------------------------------------------------------------------------------`);
      let nIdx = 1;
      SessionManager.pendingNewItems.forEach(nItem => {
        let nDesc = (nItem.desc && nItem.desc !== "Navigate to vendor website for item description.") ? `\n          | Description: ${nItem.desc}` : '';
        reportLines.push(`[ ${nIdx} ] REF: ${nItem.ref}${nDesc}\n          | GTIN: ${this.cleanGtinValue(nItem.gtin)}\n          | Manufacturer: ${nItem.mfr}\n          | Price: ${nItem.price}`); nIdx++;
      }); reportLines.push(``);
    }

    if (SessionManager.pendingFieldUpdates.length > 0) {
      reportLines.push(`--------------------------------------------------------------------------------\n--- EXISTING ITEM UPDATES (${SessionManager.pendingFieldUpdates.length}) ---\n--------------------------------------------------------------------------------`);
      let uIdx = 1;
      SessionManager.pendingFieldUpdates.forEach(upd => {
        reportLines.push(`[ ${uIdx} ] REF: ${upd.ref}\n          | GTIN: ${this.cleanGtinValue(upd.newValue)}`); uIdx++;
      }); reportLines.push(``);
    }

    if (SessionManager.scannedObjects.length > 0) {
      reportLines.push(`--------------------------------------------------------------------------------\n--- SCANNING SESSION FULL BARCODE REFERENCE DATA ---\n--------------------------------------------------------------------------------\nSession Start Time: ${SessionManager.sessionStartStr || 'N/A'}\n`);
      SessionManager.scannedObjects.forEach(item => {
        reportLines.push(`REF: ${item.ref}`);
        if (item.rawScanLines && item.rawScanLines.length > 0) {
          item.rawScanLines.forEach((lineVal, idx) => { reportLines.push(`  - Barcode Line ${idx + 1}: ${lineVal}`); });
        } else reportLines.push(`  - No raw barcodes captured.`);
        reportLines.push(``);
      });
    }

    reportLines.push(`================================================================================\nEND OF RECEIVING INVENTORY SUMMARY\n================================================================================`);
    return reportLines.join('\n');
  },

  buildHTMLReportString(filename) {
    let scannedMap = {};

    SessionManager.scannedObjects.forEach(item => {
      let rKey = item.ref;
      let cleanGtin = this.cleanGtinValue(item.gtin);
      if (!scannedMap[rKey]) {
        scannedMap[rKey] = { ref: item.ref, desc: item.desc, gtin: cleanGtin, mfr: item.mfr, price: item.price, totalScannedQty: 0, byTag: {} };
      }
      scannedMap[rKey].totalScannedQty += item.qty;

      let tKey = item.customerTag || 'UNTAGGED';
      if (!scannedMap[rKey].byTag[tKey]) scannedMap[rKey].byTag[tKey] = { tagTotalQty: 0, lots: {} };
      scannedMap[rKey].byTag[tKey].tagTotalQty += item.qty;

      let lotKey = `${item.lot}_${item.exp}`;
      if (!scannedMap[rKey].byTag[tKey].lots[lotKey]) scannedMap[rKey].byTag[tKey].lots[lotKey] = { lot: item.lot, exp: item.exp, qty: 0, notes:[] };
      scannedMap[rKey].byTag[tKey].lots[lotKey].qty += item.qty;
      if (item.itemNote) scannedMap[rKey].byTag[tKey].lots[lotKey].notes.push(item.itemNote);
    });

    let sessionTitleHeader = SessionManager.currentSessionName;
    if (SessionManager.currentOrderNum && !sessionTitleHeader.includes(SessionManager.currentOrderNum)) {
      sessionTitleHeader += ` (${SessionManager.currentOrderNum})`;
    }

    const nowObj = new Date();
    let timeEndStr = nowObj.toLocaleTimeString();
    let totalUniqueRefs = new Set(SessionManager.scannedObjects.map(i => i.ref)).size;
    let totalItemsScanned = SessionManager.scannedObjects.reduce((acc, curr) => acc + (parseInt(curr.qty, 10) || 0), 0);
    let sNote = document.getElementById('sessionNoteInput') ? document.getElementById('sessionNoteInput').value.trim() : '';

    let workflowTitle = SessionManager.currentWorkflowType ? `${SessionManager.currentWorkflowType.toUpperCase()} - ` : '';
    let mainTitle = `${workflowTitle}SESSION LOG`;

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${filename}</title>
<style>
body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; margin: 30px; font-size: 13px; }
.top-title-banner { text-align: center; border-bottom: 2px solid #0277bd; padding-bottom: 6px; margin-bottom: 14px; }
.top-title-banner h2 { margin: 0; color: #0277bd; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px; }
.header-grid { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
.company-info { flex: 1; }
.company-info h1 { margin: 0; color: #333; font-size: 14px; text-transform: uppercase; white-space: nowrap; }
.company-info p { margin: 2px 0; color: #555; font-size: 11px; }
.report-meta { text-align: right; }
.report-meta table { width: 100%; text-align: right; border: none; font-size: 12px; margin: 0; }
.report-meta td { border: none; padding: 2px 0 2px 15px; }
.section-title { background-color: #f0f0f0; border-left: 4px solid #0277bd; padding: 6px 10px; font-size: 13px; font-weight: bold; margin: 20px 0 10px 0; text-transform: uppercase; }
.data-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
.data-table th { background-color: #fafafa; border-bottom: 2px solid #ccc; padding: 6px; text-align: left; font-size: 11px; color: #555; }
.data-table td { border-bottom: 1px solid #eee; padding: 6px; vertical-align: top; }
.ref-col { font-weight: bold; color: #000; font-size: 13px; }
.desc-col { font-size: 11px; color: #666; max-width: 250px; }
.lot-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 5px; background: #fafafa; border: 1px solid #eaeaea; }
.lot-table th, .lot-table td { border: 1px solid #eaeaea; padding: 4px 6px; }
.lot-table th { background: #f0f0f0; }
.tag-header { font-weight: bold; color: #d32f2f; margin: 6px 0 4px 0; font-size: 11px; text-transform: uppercase; }
.note-text { color: #d32f2f; font-style: italic; font-size: 11px; display: block; margin-top: 3px;}
.session-notes { background-color: #fff9c4; border-left: 4px solid #fbc02d; padding: 8px 10px; margin-bottom: 15px; font-size: 12px;}
.alert-box { padding: 8px 12px; border-radius: 4px; margin-bottom: 15px; font-size: 12px; }
.alert-short { background-color: #ffebee; border-left: 4px solid #c62828; color: #c62828; }
.alert-over { background-color: #fff3e0; border-left: 4px solid #e65100; color: #e65100; }
.alert-tag { background-color: #e3f2fd; border-left: 4px solid #0277bd; color: #0277bd; }
@media print {
  body { margin: 0; padding: 15px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
</head>
<body>

<div class="top-title-banner">
  <h2>${mainTitle}</h2>
</div>

<div class="header-grid">
  <div>
    <img src="ASP_Box_Web_RGB.png" style="max-height: 50px;" alt="ASP Logo" />
  </div>
  <div class="company-info" style="margin-left: 15px;">
    <h1>Allied Surgical Products</h1>
    <p>737 Barbara Street</p>
    <p>Palm Harbor, FL 34684</p>
  </div>
  <div class="report-meta">
    <table>
      <tr><td><strong>Session:</strong></td><td>${sessionTitleHeader}</td></tr>
      <tr><td><strong>User:</strong></td><td>${SessionManager.currentUserName || 'N/A'}</td></tr>
      <tr><td><strong>Date:</strong></td><td>${SessionManager.sessionDateStr}</td></tr>
      <tr><td><strong>Time Span:</strong></td><td>${SessionManager.sessionStartStr} - ${timeEndStr}</td></tr>
      <tr><td><strong>Unique REFs:</strong></td><td>${totalUniqueRefs}</td></tr>
      <tr><td><strong>Total Items:</strong></td><td>${totalItemsScanned}</td></tr>
    </table>
  </div>
</div>`;

    if (sNote) {
      html += `<div class="session-notes"><strong>Session Notes:</strong> ${sNote}</div>`;
    }

    // SCANNED ITEM BREAKDOWN
    html += `<div class="section-title">📦 SCANNED ITEM BREAKDOWN</div>`;
    html += `<table class="data-table"><thead><tr><th>REF / MFR</th><th>Description & GTIN</th><th>Inventory Lots & Quantities</th><th style="text-align:center;">Total Qty</th></tr></thead><tbody>`;
    
    for (let rKey in scannedMap) {
      let rData = scannedMap[rKey];
      let lotSection = '';
      for (let tKey in rData.byTag) {
        let tagData = rData.byTag[tKey];
        if (tKey !== 'UNTAGGED') lotSection += `<div class="tag-header">Tag: ${tKey} (Qty: ${tagData.tagTotalQty})</div>`;
        
        lotSection += `<table class="lot-table"><tr><th>Lot Number</th><th>Exp Date</th><th>Qty</th></tr>`;
        for (let lKey in tagData.lots) {
           let lData = tagData.lots[lKey];
           let noteStr = lData.notes.length > 0 ? `<span class="note-text">${lData.notes.join('<br>')}</span>` : '';
           lotSection += `<tr><td>${lData.lot}${noteStr}</td><td>${lData.exp}</td><td style="text-align:center; font-weight:bold;">${lData.qty}</td></tr>`;
        }
        lotSection += `</table>`;
      }
      let descText = rData.desc || 'No description available.';
      let priceHtml = rData.price ? `<br><strong style="color:#2e7d32;">${rData.price}</strong>` : '';
      html += `<tr><td><div class="ref-col">${rData.ref}</div><div style="font-size:11px; color:#888; margin-top:2px;">${rData.mfr}</div></td><td><div class="desc-col">${descText}</div><div style="font-size:10px; margin-top:4px;"><strong>GTIN:</strong> ${rData.gtin}</div>${priceHtml}</td><td>${lotSection}</td><td style="text-align:center; font-size:16px; font-weight:bold;">${rData.totalScannedQty}</td></tr>`;
    }
    html += `</tbody></table>`;

    // ROUTED TO CUSTOMER BINS (MOVED AFTER BREAKDOWN)
    let reservedItems = SessionManager.scannedObjects.filter(i => i.customerTag);
    if (reservedItems.length > 0) {
      let totalReservedQty = reservedItems.reduce((acc, curr) => acc + (parseInt(curr.qty, 10) || 0), 0);
      html += `<div class="section-title" style="border-color:#0277bd; color:#0277bd;">🚩 ROUTED TO CUSTOMER BINS</div><div class="alert-box alert-tag"><table style="width:100%;"><thead><tr><th style="text-align:left;">REF</th><th style="text-align:left;">Customer Tag</th><th style="text-align:center;">Quantity Routed</th></tr></thead><tbody>`;
      reservedItems.forEach(r => {
        html += `<tr><td><strong>${r.ref}</strong></td><td>${r.customerTag}</td><td style="text-align:center; font-weight:bold;">${r.qty}</td></tr>`;
      });
      html += `<tr style="border-top:2px solid #0277bd;"><td colspan="2" style="text-align:right; font-weight:bold; padding-top:6px;">Total Quantity Reserved:</td><td style="text-align:center; font-weight:bold; font-size:13px; padding-top:6px;">${totalReservedQty}</td></tr>`;
      html += `</tbody></table></div>`;
    }

    // ITEMS REQUIRING PRICING (AT VERY END)
    if (SessionManager.currentWorkflowType.includes('Receiving')) {
      let unpricedItems = Object.values(scannedMap).filter(i => !i.price || i.price === "$0.00" || i.price === "0");
      if (unpricedItems.length > 0) {
        html += `
          <div style="margin-top: 20px; page-break-inside: avoid;">
            <div class="section-title" style="border-color:#7b1fa2; color:#7b1fa2;">🏷️ ITEMS REQUIRING PRICING (${unpricedItems.length})</div>
            <table class="data-table" style="width:100%;">
              <thead>
                <tr style="background-color:#f3e5f5;">
                  <th style="padding:6px; text-align:left;">REF / SKU</th>
                  <th style="padding:6px; text-align:left;">Manufacturer</th>
                </tr>
              </thead>
              <tbody>`;
        unpricedItems.forEach(u => {
          html += `<tr><td style="font-weight:bold;">${u.ref}</td><td>${u.mfr}</td></tr>`;
        });
        html += `</tbody></table></div>`;
      }
    }

    // SHORTAGES
    if (SessionManager.isManifestEnabled && SessionManager.expectedManifest.length > 0) {
      let shortages = [];
      SessionManager.expectedManifest.forEach(exp => {
        let scannedObj = scannedMap[exp.ref];
        let scannedQty = scannedObj ? scannedObj.totalScannedQty : 0;
        if (scannedQty < exp.expectedQty) {
          shortages.push({ ref: exp.ref, expected: exp.expectedQty, scanned: scannedQty, shortQty: exp.expectedQty - scannedQty });
        }
      });

      if (shortages.length > 0) {
        html += `<div class="section-title" style="border-color:#c62828; color:#c62828;">⚠️ SHORTAGES / MISSING ITEMS</div><div class="alert-box alert-short"><table style="width:100%;"><tr><th>REF</th><th>Expected</th><th>Scanned</th><th>Shortage</th></tr>`;
        shortages.forEach(s => {
          html += `<tr><td><strong>${s.ref}</strong></td><td style="text-align:center;">${s.expected}</td><td style="text-align:center;">${s.scanned}</td><td style="text-align:center; font-weight:bold; color:#c62828;">-${s.shortQty}</td></tr>`;
        });
        html += `</table></div>`;
      }
    }

    // OVERAGES
    if (SessionManager.isManifestEnabled && SessionManager.expectedManifest.length > 0) {
      let overages = [];
      Object.keys(scannedMap).forEach(rKey => {
        let expObj = SessionManager.expectedManifest.find(e => e.ref === rKey);
        let expQty = expObj ? expObj.expectedQty : 0;
        let scannedQty = scannedMap[rKey].totalScannedQty;
        if (scannedQty > expQty) {
          overages.push({ ref: rKey, expected: expQty, scanned: scannedQty, overQty: scannedQty - expQty });
        }
      });

      if (overages.length > 0) {
        html += `<div class="section-title" style="border-color:#e65100; color:#e65100;">⚠️ OVERAGES / UNEXPECTED ITEMS</div><div class="alert-box alert-over"><table style="width:100%;"><tr><th>REF</th><th>Expected</th><th>Scanned</th><th>Overage</th></tr>`;
        overages.forEach(o => {
          html += `<tr><td><strong>${o.ref}</strong></td><td style="text-align:center;">${o.expected}</td><td style="text-align:center;">${o.scanned}</td><td style="text-align:center; font-weight:bold; color:#e65100;">+${o.overQty}</td></tr>`;
        });
        html += `</table></div>`;
      }
    }

    html += `</body></html>`; 
    return html;
  },

  // ==========================================================================
  // CUSTOMER INTERNAL SALES REPORT ENGINE
  // ==========================================================================
  openInternalSalesReportOptions() {
    let cust = document.getElementById('customerReportSelect').value;
    if (!cust) { alert("Please select a customer first."); return; }

    // Read the scope selected in screens/reports.html
    let scopeRadio = document.querySelector('input[name="internalReportScope"]:checked');
    let limit = scopeRadio ? scopeRadio.value : '10';

    let modal = document.createElement('div');
    modal.id = 'internalReportOptionsModal';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:99999; display:flex; justify-content:center; align-items:center; padding:15px; box-sizing:border-box;';
    
    modal.innerHTML = `
      <div style="background:#fff; border-radius:8px; width:100%; max-width:500px; padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #388e3c; padding-bottom:8px; margin-bottom:15px;">
          <h3 style="margin:0; color:#388e3c;">📈 Internal Sales Report Options</h3>
          <button onclick="document.getElementById('internalReportOptionsModal').remove()" style="background:none; border:none; font-size:1.5rem; cursor:pointer;">&times;</button>
        </div>
        <div style="margin-bottom:15px; font-size:0.85rem;">Account: <strong>${cust}</strong><br>Select the columns you want to include in the PDF export:</div>
        
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:20px; background:#fafafa; border:1px solid #ddd; padding:12px; border-radius:4px;">
          <label style="cursor:pointer;"><input type="checkbox" id="chkIntDesc" checked> Description</label>
          <label style="cursor:pointer;"><input type="checkbox" id="chkIntHist" checked> Historical Vol.</label>
          <label style="cursor:pointer;"><input type="checkbox" id="chkIntOnHand" checked> On-Hand Stock</label>
          <label style="cursor:pointer;"><input type="checkbox" id="chkIntPrice" checked> Selling Price</label>
          <label style="cursor:pointer;"><input type="checkbox" id="chkIntCost" checked> Unit Cost</label>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button onclick="document.getElementById('internalReportOptionsModal').remove()" style="background:#777; color:#fff; border:none; padding:8px 16px; border-radius:4px; cursor:pointer;">Cancel</button>
          <!-- Pass the limit variable straight into generateInternalSalesReport -->
          <button onclick="AuditManager.generateInternalSalesReport('${cust}', '${limit}')" style="background:#388e3c; color:#fff; border:none; padding:8px 20px; border-radius:4px; font-weight:bold; cursor:pointer;">🖨️ Export PDF</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  generateInternalSalesReport(cust) {
    if (!cust) return;
    
    // Read the limit selection from the modal radio buttons
    let limitRadio = document.querySelector('input[name="internalReportScope"]:checked');
    let limit = limitRadio ? limitRadio.value : '10';

    let incDesc = document.getElementById('chkIntDesc') ? document.getElementById('chkIntDesc').checked : true;
    let incHist = document.getElementById('chkIntHist') ? document.getElementById('chkIntHist').checked : true;
    let incOnHand = document.getElementById('chkIntOnHand') ? document.getElementById('chkIntOnHand').checked : true;
    let incPrice = document.getElementById('chkIntPrice') ? document.getElementById('chkIntPrice').checked : true;
    let incCost = document.getElementById('chkIntCost') ? document.getElementById('chkIntCost').checked : true;

    let scopeTitle = limit === 'all' ? 'All Historical Items' : 'Top 10 Items';
    // Remove the .pdf here
    let filename = `Internal_Sales_Report_${cust}_${SessionManager.sessionDateStr}`;

    // Pass the limit parameter here!
    let skuMap = this.getHistoricalCustomerData(cust, limit); 
    
    let html = `<!DOCTYPE html><html><head><title>${filename}</title>
    <style>
      body { font-family: 'Helvetica Neue', Arial, sans-serif; margin:30px; color:#333; font-size:12px; }
      .header { border-bottom:3px solid #0277bd; padding-bottom:10px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; }
      h1 { margin:0; color:#0277bd; font-size:18px; text-transform:uppercase; }
      .meta { text-align:right; font-size:11px; color:#555; }
      table { width:100%; border-collapse:collapse; margin-top:15px; font-size:11px; }
      th { background:#f0f0f0; border:1px solid #ccc; padding:8px; text-align:center; color:#333; font-size:11px; }
      td { border:1px solid #eee; padding:8px; text-align:center; }
      .ref-cell { text-align:left; font-weight:bold; color:#0277bd; }
      .desc-cell { text-align:left; font-size:10px; color:#555; }
      .summary-box { background:#e3f2fd; border-left:4px solid #0277bd; padding:10px; margin-bottom:15px; font-size:11px; }
    </style></head><body>
    
    <div class="header">
      <div>
        <h1>Customer Internal Sales Report</h1>
        <div style="font-size:12px; font-weight:bold; color:#555; margin-top:4px;">Account: ${cust}</div>
      </div>
      <div class="meta">
        <div>Allied Surgical Products</div>
        <div>Generated: ${SessionManager.sessionDateStr}</div>
      </div>
    </div>

    <div class="summary-box">
      <strong>Internal Strategy Brief:</strong> ${scopeTitle} purchasing trends and live warehouse stock availability for account <strong>${cust}</strong>.
    </div>

    <table>
      <thead>
        <tr>
          <th>REF / SKU</th>
          ${incDesc ? '<th>Description</th>' : ''}
          ${incHist ? '<th>Historical Vol.</th>' : ''}
          ${incOnHand ? '<th>On-Hand Stock</th>' : ''}
          ${incPrice ? '<th>Selling Price</th>' : ''}
          ${incCost ? '<th>Unit Cost</th>' : ''}
        </tr>
      </thead>
      <tbody>`;

    skuMap.forEach(item => {
      let formattedPrice = item.price ? (item.price.startsWith('$') ? item.price : '$' + item.price) : '$0.00';
      let formattedCost = item.cost ? (item.cost.startsWith('$') ? item.cost : '$' + item.cost) : '$0.00';

      html += `
        <tr>
          <td class="ref-cell">${item.ref}</td>
          ${incDesc ? `<td class="desc-cell">${item.desc}</td>` : ''}
          ${incHist ? `<td><strong>${item.histQty} units</strong></td>` : ''}
          ${incOnHand ? `<td style="color:${item.onHand > 0 ? '#2e7d32' : '#c62828'}; font-weight:bold;">${item.onHand}</td>` : ''}
          ${incPrice ? `<td>${formattedPrice}</td>` : ''}
          ${incCost ? `<td>${formattedCost}</td>` : ''}
        </tr>`;
    });

    html += `</tbody></table></body></html>`;

    let win = window.open('', '_blank');
    if (win) { 
      win.document.write(html); 
      let safeTitle = filename.replace(/\./g, '\u2024');
      win.document.title = safeTitle; 
      win.focus(); 
      setTimeout(() => win.print(), UIManager.printTimeout);
    }
    
    let modal = document.getElementById('internalReportOptionsModal');
    if (modal) modal.remove();
  },

  // ==========================================================================
  // CUSTOMER INVENTORY STOCK REPORT EDITOR (CUSTOMER-FACING)
  // ==========================================================================
  openCustomerStockReportEditor() {
    let cust = document.getElementById('customerReportSelect').value;
    if (!cust) { alert("Please select a customer first."); return; }

    // Read the scope selected in screens/reports.html
    let scopeRadio = document.querySelector('input[name="internalReportScope"]:checked');
    let limit = scopeRadio ? scopeRadio.value : '10';

    let items = this.getHistoricalCustomerData(cust, limit).filter(i => {
      let numPrice = parseFloat(String(i.price || '').replace(/[^0-9.-]+/g, '')) || 0;
      return numPrice > 0;
    });
    
    let existingModal = document.getElementById('stockReportEditorModal');
    if (existingModal) existingModal.remove();

    let modal = document.createElement('div');
    modal.id = 'stockReportEditorModal';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:99999; display:flex; justify-content:center; align-items:center; padding:15px; box-sizing:border-box;';
    
    let rowsHtml = '';
    items.forEach((it, idx) => {
      let safeDesc = (it.desc || '').replace(/"/g, '&quot;');
      let safeRef = (it.ref || '').replace(/"/g, '&quot;');
      let safePrice = (it.price || '').replace(/"/g, '&quot;');

      rowsHtml += `
        <div style="display:flex; gap:6px; align-items:center; margin-bottom:6px;" id="reportEditRow_${idx}" class="flyer-item-row">
          <input type="checkbox" class="flyer-chk" checked style="display:none;">
          <input type="text" value="${safeRef}" class="rep-ref" style="width:90px; padding:4px; font-weight:bold; text-transform:uppercase;">
          <input type="text" value="${safeDesc}" class="rep-desc" style="flex:1; padding:4px; font-size:0.8rem;">
          <input type="number" value="${it.onHand}" class="rep-qty" style="width:60px; padding:4px; text-align:center;">
          <input type="text" value="${safePrice}" class="rep-price" style="width:70px; padding:4px; text-align:center;">
          <button onclick="this.parentElement.remove()" style="background:#c62828; color:#fff; border:none; padding:4px 8px; border-radius:3px; cursor:pointer;">🗑️</button>
        </div>`;
    });

    let top10Checked = limit === '10' ? 'checked' : '';
    let allChecked = limit === 'all' ? 'checked' : '';

    modal.innerHTML = `
      <div style="background:#fff; border-radius:8px; width:100%; max-width:600px; max-height:90vh; overflow-y:auto; padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #7b1fa2; padding-bottom:8px; margin-bottom:15px;">
          <h3 style="margin:0; color:#7b1fa2;">📄 Build "Customer Inventory Stock Report"</h3>
          <button onclick="document.getElementById('stockReportEditorModal').remove()" style="background:none; border:none; font-size:1.5rem; cursor:pointer;">&times;</button>
        </div>

        <div style="background:#f3e5f5; border:1px solid #ce93d8; border-radius:4px; padding:10px; margin-bottom:15px; font-size:0.85rem;">
          <strong>Account:</strong> ${cust}<br>
          Customize the SKUs, descriptions, stock quantities, and pricing below before exporting.
        </div>

        <div style="margin-bottom:15px; background:#fafafa; border:1px solid #ddd; padding:10px; border-radius:4px; display:flex; flex-wrap:wrap; gap:15px;">
          <label style="font-weight:bold; cursor:pointer; font-size:0.85rem; color:#333;"><input type="checkbox" id="chkIncludeDescFlyer" checked> Include Description</label>
          <label style="font-weight:bold; cursor:pointer; font-size:0.85rem; color:#333;"><input type="checkbox" id="chkIncludeQtyFlyer" checked> Include Quantity</label>
          <label style="font-weight:bold; cursor:pointer; font-size:0.85rem; color:#333;"><input type="checkbox" id="chkIncludePriceInReport" checked> Include Unit Price</label>
        </div>

        <div id="reportItemRowsContainer">${rowsHtml}</div>
        <button onclick="AuditManager.addBlankRowToReportEditor()" style="background:#0277bd; color:#fff; border:none; padding:6px 12px; border-radius:4px; font-size:0.8rem; margin-top:8px; cursor:pointer;">+ Add Item to Flyer</button>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px; border-top:1px solid #eee; padding-top:12px;">
          <button onclick="document.getElementById('stockReportEditorModal').remove()" style="background:#777; color:#fff; border:none; padding:8px 16px; border-radius:4px; cursor:pointer;">Cancel</button>
          <button onclick="AuditManager.exportCustomerStockReportPDF('${cust}')" style="background:#7b1fa2; color:#fff; border:none; padding:8px 20px; border-radius:4px; font-weight:bold; cursor:pointer;">🖨️ Export PDF</button>
          <button onclick="AuditManager.draftEmailFlyer('${cust}')" style="background:#2e7d32; color:#fff; border:none; padding:8px 20px; border-radius:4px; font-weight:bold; cursor:pointer;">📧 Copy to Email</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  openCustomSalesFlyer() {
    // Remove the strict customer requirement. Use "PROMO" if the dropdown is blank.
    let custInput = document.getElementById('customerReportSelect');
    let cust = (custInput && custInput.value) ? custInput.value : 'PROMO';

    let existingModal = document.getElementById('stockReportEditorModal');
    if (existingModal) existingModal.remove();

    let modal = document.createElement('div');
    modal.id = 'stockReportEditorModal';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:99999; display:flex; justify-content:center; align-items:center; padding:15px; box-sizing:border-box;';
    
    // Pull ALL available inventory directly from the master database
    let availableItems = [];
    if (typeof DatabaseManager !== 'undefined' && DatabaseManager.db) {
      availableItems = DatabaseManager.db.filter(dbItem => {
        let total = parseInt(dbItem.onHand, 10) || 0;
        let res = parseInt(dbItem.reservedQty, 10) || 0;
        return (total - res) > 0;
      }).map(dbItem => {
        return {
          ref: DatabaseManager.getItemSku(dbItem),
          desc: DatabaseManager.getItemDesc(dbItem),
          onHand: (parseInt(dbItem.onHand, 10) || 0) - (parseInt(dbItem.reservedQty, 10) || 0),
          price: dbItem.price || '$0.00'
        };
      }).sort((a, b) => a.ref.localeCompare(b.ref));
    }

    let rowsHtml = '';
    availableItems.forEach((it, idx) => {
      let safeDesc = String(it.desc || '').replace(/"/g, '&quot;'); 
      let safeRef = String(it.ref || '').replace(/"/g, '&quot;'); 
      let safePrice = String(it.price || '').replace(/"/g, '&quot;');
      
      // Removed the "checked" attribute so you don't have to uncheck hundreds of items manually
      rowsHtml += `
        <div style="display:flex; gap:6px; align-items:center; margin-bottom:8px; padding:6px; background:#f9f9f9; border:1px solid #eee; border-radius:4px;" class="flyer-item-row">
          <input type="checkbox" class="flyer-chk" style="width:20px; height:20px; cursor:pointer;">
          <input type="text" value="${safeRef}" class="rep-ref" readonly style="width:90px; padding:4px; font-weight:bold; background:#e0e0e0; border:1px solid #ccc; color:#555;">
          <input type="text" value="${safeDesc}" class="rep-desc" style="flex:1; padding:4px; font-size:0.8rem;">
          <input type="number" value="${it.onHand}" max="${it.onHand}" min="1" class="rep-qty" style="width:60px; padding:4px; text-align:center;" onchange="if(this.value > ${it.onHand}) { UIManager.showCustomAlert('Limit Reached', 'Cannot exceed available quantity of ${it.onHand}'); this.value = ${it.onHand}; }">
          <input type="text" value="${safePrice}" class="rep-price" style="width:70px; padding:4px; text-align:center;">
        </div>`;
    });

    modal.innerHTML = `
      <div style="background:#fff; border-radius:8px; width:100%; max-width:700px; max-height:90vh; overflow-y:auto; padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #f57f17; padding-bottom:8px; margin-bottom:15px;">
          <h3 style="margin:0; color:#f57f17;">✨ Custom Promotional Flyer</h3>
          <button onclick="document.getElementById('stockReportEditorModal').remove()" style="background:none; border:none; font-size:1.5rem; cursor:pointer;">&times;</button>
        </div>
        <div style="background:#fff3e0; border:1px solid #ffcc80; border-radius:4px; padding:10px; margin-bottom:15px; font-size:0.85rem;">
          Build a custom flyer from the <strong>Full Warehouse Inventory</strong>. Select items and set quantities below.
        </div>
        <div style="margin-bottom:15px; background:#fafafa; border:1px solid #ddd; padding:10px; border-radius:4px; display:flex; flex-wrap:wrap; gap:15px;">
          <label style="font-weight:bold; cursor:pointer; font-size:0.85rem; color:#333;"><input type="checkbox" id="chkIncludeDescFlyer" checked> Include Description</label>
          <label style="font-weight:bold; cursor:pointer; font-size:0.85rem; color:#333;"><input type="checkbox" id="chkIncludeQtyFlyer" checked> Include Quantity</label>
          <label style="font-weight:bold; cursor:pointer; font-size:0.85rem; color:#333;"><input type="checkbox" id="chkIncludePriceInReport" checked> Include Unit Price</label>
        </div>
        <div style="margin-bottom:10px;">
          <label style="font-size:0.85rem; font-weight:bold; color:#0277bd;">📝 Add Flyer Note / Intro Text:</label>
          <textarea id="flyerNoteInput" rows="3" style="width:100%; padding:8px; font-size:0.85rem; resize:vertical;" placeholder="e.g. Good morning, we have the following items in stock..."></textarea>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding: 0 4px;">
          <strong style="font-size:0.9rem; color:#333;">Available Inventory (${availableItems.length} items)</strong>
          <div>
            <button class="btn-small btn-auto" style="background:#0277bd; color:#fff; padding:4px 8px;" onclick="document.querySelectorAll('.flyer-chk').forEach(c => c.checked = true)">Select All</button>
            <button class="btn-small btn-auto" style="background:#757575; color:#fff; padding:4px 8px;" onclick="document.querySelectorAll('.flyer-chk').forEach(c => c.checked = false)">Deselect All</button>
          </div>
        </div>
        <div id="reportItemRowsContainer" style="max-height:300px; overflow-y:auto; border:1px solid #ccc; padding:6px; border-radius:4px; background:#fff;">
          ${rowsHtml.length > 0 ? rowsHtml : '<div style="text-align:center; padding:10px; color:#777;">No items currently available in stock.</div>'}
        </div>
        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px; border-top:1px solid #eee; padding-top:12px;">
          <button onclick="document.getElementById('stockReportEditorModal').remove()" style="background:#777; color:#fff; border:none; padding:8px 16px; border-radius:4px; cursor:pointer;">Cancel</button>
          <button onclick="AuditManager.exportCustomerStockReportPDF('${cust}')" style="background:#7b1fa2; color:#fff; border:none; padding:8px 20px; border-radius:4px; font-weight:bold; cursor:pointer;">🖨️ Export PDF</button>
          <button onclick="AuditManager.draftEmailFlyer('${cust}')" style="background:#2e7d32; color:#fff; border:none; padding:8px 20px; border-radius:4px; font-weight:bold; cursor:pointer;">📧 Copy to Email</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  addBlankRowToReportEditor() {
    let container = document.getElementById('reportItemRowsContainer');
    let div = document.createElement('div');
    div.className = 'flyer-item-row';
    div.style.cssText = 'display:flex; gap:6px; align-items:center; margin-bottom:6px;';
    div.innerHTML = `
      <input type="checkbox" class="flyer-chk" checked style="display:none;">
      <input type="text" placeholder="REF" class="rep-ref" style="width:90px; padding:4px; font-weight:bold; text-transform:uppercase;">
      <input type="text" placeholder="Item Description" class="rep-desc" style="flex:1; padding:4px; font-size:0.8rem;">
      <input type="number" value="1" class="rep-qty" style="width:60px; padding:4px; text-align:center;">
      <input type="text" placeholder="$0.00" class="rep-price" style="width:70px; padding:4px; text-align:center;">
      <button onclick="this.parentElement.remove()" style="background:#c62828; color:#fff; border:none; padding:4px 8px; border-radius:3px; cursor:pointer;">🗑️</button>
    `;
    container.appendChild(div);
  },

  draftEmailFlyer(cust) {
    let includeDesc = document.getElementById('chkIncludeDescFlyer') ? document.getElementById('chkIncludeDescFlyer').checked : true;
    let includeQty = document.getElementById('chkIncludeQtyFlyer') ? document.getElementById('chkIncludeQtyFlyer').checked : true;
    let includePrice = document.getElementById('chkIncludePriceInReport') ? document.getElementById('chkIncludePriceInReport').checked : true;
    let flyerNote = document.getElementById('flyerNoteInput') ? document.getElementById('flyerNoteInput').value.trim() : '';
    
    let container = document.getElementById('reportItemRowsContainer');
    let rows = container.querySelectorAll('.flyer-item-row');
    
    let html = `<div id="flyerCanvasTarget" style="font-family: Arial, sans-serif; font-size: 14px; width: 700px; padding: 20px; background-color: #ffffff; color: #333333;">`;
    
    if (flyerNote) { html += `<div style="white-space: pre-wrap; margin-bottom: 15px; font-size: 13px;">${flyerNote}</div>`; }

    html += `<table style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 13px; margin-top: 15px; margin-bottom: 15px;">
      <thead>
        <tr style="background-color: #0277bd; color: #ffffff;">
          <th style="padding: 10px; border: 1px solid #ccc; text-align: left;">Reference</th>
          ${includeDesc ? '<th style="padding: 10px; border: 1px solid #ccc; text-align: left;">Description</th>' : ''}
          ${includeQty ? '<th style="padding: 10px; border: 1px solid #ccc; text-align: center;">Quantity On Hand</th>' : ''}
          ${includePrice ? '<th style="padding: 10px; border: 1px solid #ccc; text-align: right;">Price</th>' : ''}
        </tr>
      </thead>
      <tbody>`;
      
    rows.forEach(r => {
      let chk = r.querySelector('.flyer-chk');
      if (chk && !chk.checked) return;

      let ref = r.querySelector('.rep-ref').value.trim(); let desc = r.querySelector('.rep-desc').value.trim();
      let qty = r.querySelector('.rep-qty').value.trim(); let price = r.querySelector('.rep-price').value.trim();
      let formattedPrice = price ? (price.startsWith('$') || isNaN(parseFloat(price.replace(/[^0-9.-]+/g,""))) ? price : '$' + price) : 'Call for Price';

      if (ref) {
        html += `<tr style="background-color: #ffffff;">
          <td style="padding: 10px; border: 1px solid #ccc; font-weight: bold; color: #0277bd;">${ref}</td>
          ${includeDesc ? `<td style="padding: 10px; border: 1px solid #ccc;">${desc}</td>` : ''}
          ${includeQty ? `<td style="padding: 10px; border: 1px solid #ccc; text-align: center; font-weight: bold;">${qty}</td>` : ''}
          ${includePrice ? `<td style="padding: 10px; border: 1px solid #ccc; text-align: right; color: #2e7d32; font-weight: bold;">${formattedPrice}</td>` : ''}
        </tr>`;
      }
    });
    
    html += `</tbody></table></div>`;
      
    let tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
    tempDiv.style.position = 'absolute'; tempDiv.style.left = '-9999px'; tempDiv.style.top = '-9999px';
    document.body.appendChild(tempDiv);
    
    let target = document.getElementById('flyerCanvasTarget');
    if (typeof html2canvas !== 'undefined') {
      html2canvas(target, { scale: 2, backgroundColor: "#ffffff" }).then(canvas => {
        canvas.toBlob(blob => {
          try {
            navigator.clipboard.write([new window.ClipboardItem({'image/png': blob})]).then(() => {
              UIManager.showCustomAlert("Success", "✅ The flyer has been copied to your clipboard as a picture. You can now safely paste it into your email draft.");
            });
          } catch (e) { UIManager.showCustomAlert("Notice", "Clipboard image copy not fully supported by this browser. Falling back to HTML."); }
        }, 'image/png');
        document.body.removeChild(tempDiv);
      });
    } else { document.body.removeChild(tempDiv); UIManager.showCustomAlert("Loading", "Image rendering library is loading. Please try again in a few seconds."); }
  },

  exportCustomerStockReportPDF(cust) {
    let includeDesc = document.getElementById('chkIncludeDescFlyer') ? document.getElementById('chkIncludeDescFlyer').checked : true;
    let includeQty = document.getElementById('chkIncludeQtyFlyer') ? document.getElementById('chkIncludeQtyFlyer').checked : true;
    let includePrice = document.getElementById('chkIncludePriceInReport') ? document.getElementById('chkIncludePriceInReport').checked : true;
    let flyerNote = document.getElementById('flyerNoteInput') ? document.getElementById('flyerNoteInput').value.trim() : '';
    
    let container = document.getElementById('reportItemRowsContainer');
    let rows = container.querySelectorAll('.flyer-item-row');
    let safeDate = SessionManager.sessionDateStr.replace(/\./g, '_');
    // Remove the .pdf here
    let filename = `Customer_Stock_Flyer_${cust}_${safeDate}`;

    let html = `<!DOCTYPE html><html><head><title>${filename}</title>
    <style>
      body { font-family: 'Helvetica Neue', Arial, sans-serif; margin:35px; color:#333; font-size:12px; }
      .header-grid { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #0277bd; padding-bottom:12px; margin-bottom:20px; }
      .company-info h1 { margin:0; color:#0277bd; font-size:20px; text-transform:uppercase; letter-spacing:0.5px; }
      .company-info p { margin:2px 0; color:#555; font-size:11px; }
      .flyer-title { background:#f5f5f5; border-left:5px solid #0277bd; padding:10px; font-size:14px; font-weight:bold; color:#0277bd; margin-bottom:20px; text-transform:uppercase; }
      table { width:100%; border-collapse:collapse; margin-top:10px; font-size:12px; }
      th { background:#fafafa; border-bottom:2px solid #ccc; padding:10px; text-align:left; color:#555; font-size:11px; text-transform:uppercase; }
      td { border-bottom:1px solid #eee; padding:10px; vertical-align:middle; }
      .ref-col { font-weight:bold; color:#000; font-size:13px; }
      .desc-col { font-size:11px; color:#555; }
      .qty-badge { background:#e8f5e9; color:#2e7d32; font-weight:bold; padding:4px 8px; border-radius:4px; font-size:13px; display:inline-block; }
      .footer-note { margin-top:30px; border-top:1px solid #ddd; padding-top:12px; font-size:11px; color:#777; text-align:center; font-style:italic; }
    </style></head><body>

    <div class="header-grid">
      <div class="company-info">
        <h1>Allied Surgical Products</h1>
        <p>737 Barbara Street | Palm Harbor, FL 34684</p>
      </div>
      <div style="text-align:right;">
        <div style="font-size:13px; font-weight:bold; color:#333;">ACCOUNT: ${cust}</div>
        <div style="font-size:11px; color:#777;">Date: ${SessionManager.sessionDateStr}</div>
      </div>
    </div>
    <div class="flyer-title">📦 AVAILABLE INVENTORY - READY TO SHIP</div>`;

    if (flyerNote) { html += `<div style="white-space: pre-wrap; font-size: 13px; margin-bottom: 20px; color: #333;">${flyerNote}</div>`; }

    html += `<table><thead><tr><th>REF / Product Code</th>${includeDesc ? '<th>Description</th>' : ''}${includeQty ? '<th style="text-align:center;">Quantity Available</th>' : ''}${includePrice ? '<th style="text-align:right;">Unit Price</th>' : ''}</tr></thead><tbody>`;

    rows.forEach(r => {
      // Check for the checkbox status first
      let chk = r.querySelector('.flyer-chk');
      if (chk && !chk.checked) return;

      // Then gather the rest of the data
      let ref = r.querySelector('.rep-ref').value.trim(); 
      let desc = r.querySelector('.rep-desc').value.trim();
      let qty = r.querySelector('.rep-qty').value.trim(); 
      let price = r.querySelector('.rep-price').value.trim();
      let formattedPrice = price ? (price.startsWith('$') || isNaN(parseFloat(price.replace(/[^0-9.-]+/g,""))) ? price : '$' + price) : 'Inquire';

      if (ref) {
        html += `<tr><td class="ref-col">${ref}</td>${includeDesc ? `<td class="desc-col">${desc || 'Surgical Products Item'}</td>` : ''}${includeQty ? `<td style="text-align:center;"><span class="qty-badge">${qty}</span></td>` : ''}${includePrice ? `<td style="text-align:right; font-weight:bold; color:#2e7d32;">${formattedPrice}</td>` : ''}</tr>`;
      }
    });

    html += `</tbody></table>
    <div class="footer-note">Contact your Allied Surgical Products representative to place your order.</div>
    </body></html>`;

    let win = window.open('', '_blank');
    if (win) { 
      win.document.write(html); 
      let safeTitle = filename.replace(/\./g, '\u2024');
      win.document.title = safeTitle; 
      win.focus(); 
      setTimeout(() => win.print(), UIManager.printTimeout); // Increased timeout
    }

    document.getElementById('stockReportEditorModal').remove();
  },

  getHistoricalCustomerData(cust, limit = '10') {
    let cleanCust = cust.toUpperCase().trim();
    let skuVolumeMap = {};

    // Primary Source: Aggregate directly from active master allocations
    let allocations = JSON.parse(localStorage.getItem('asp_allocations')) || {};
    let custAllocations = allocations[cleanCust] || {};
    
    // ✨ FIX: Safely extract integer quantity if the data is an object
    Object.keys(custAllocations).forEach(ref => {
      let rawVal = custAllocations[ref];
      let allocQty = typeof rawVal === 'object' ? (rawVal.qty || 0) : (parseInt(rawVal, 10) || 0);
      skuVolumeMap[ref] = (skuVolumeMap[ref] || 0) + allocQty;
    });

    // Layer in remote analytics if present (for historical context)
    let analytics = JSON.parse(localStorage.getItem('asp_remote_analytics')) || {};
    let remoteSkuCounts = analytics[cleanCust] || {};
    Object.keys(remoteSkuCounts).forEach(ref => {
      skuVolumeMap[ref] = (skuVolumeMap[ref] || 0) + remoteSkuCounts[ref];
    });

    let resultList = [];
    let sortedSkus = Object.keys(skuVolumeMap).sort((a,b) => skuVolumeMap[b] - skuVolumeMap[a]);
    
    if (limit !== 'all') {
      sortedSkus = sortedSkus.slice(0, parseInt(limit, 10));
    }
    
    sortedSkus.forEach(ref => {
      let dbItem = DatabaseManager.db.find(i => DatabaseManager.getItemSku(i) === ref);
      resultList.push({
        ref: ref,
        desc: dbItem ? DatabaseManager.getItemDesc(dbItem) : 'Surgical Item',
        histQty: skuVolumeMap[ref] || 0,
        onHand: dbItem ? (dbItem.onHand || 0) : 0, 
        price: dbItem ? dbItem.price : '$0.00',
        cost: dbItem ? (dbItem.cost || '$0.00') : '$0.00'
      });
    });

    return resultList;
  },

  async exportSessionData(formatType) {
    if (SessionManager.scannedObjects.length === 0 && SessionManager.pendingNewItems.length === 0 && SessionManager.pendingFieldUpdates.length === 0) {
      alert("No data was scanned in this session.");
      return;
    }

    let safeDate = (SessionManager.sessionDateStr || '').trim();
    let cleanSession = (SessionManager.currentSessionName || 'Session').replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_\-\(\)\&\s]/g, '_').trim();
    let cleanWorkflow = (SessionManager.currentWorkflowType || 'Workflow').replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_\-\(\)\&\s]/g, '_').trim();
    let baseFilename = `${safeDate} - ${cleanSession} - ${cleanWorkflow}`;

    if (formatType === 'pdf') {
      let fileContent = this.buildHTMLReportString(baseFilename);
      
      let printWin = window.open('', '_blank');
      if (!printWin) { 
        alert("Pop-up blocked! Please allow pop-ups to generate the PDF."); 
        return; 
      }

      printWin.document.open();
      printWin.document.write(fileContent);
      printWin.document.close();

      // The "Magic Dot" Trick 
      // Replaces standard periods with a Unicode Dot Leader (\u2024) to bypass the OS extension bug
      let safeTitle = baseFilename.replace(/\./g, '\u2024');
      printWin.document.title = safeTitle;

      printWin.onload = () => {
        setTimeout(() => {
          printWin.focus();
          printWin.print();
        }, UIManager.printTimeout);
      };
      
      return;
    }

    let filename = `${baseFilename}.txt`;
    let fileContent = this.buildTXTReportString();
    let mime = 'text/plain';
    await UIManager.triggerShareOrDownload(fileContent, filename, mime);
  },

  // ==========================================================================
  // MULTI-SESSION AUDIT & TRACEABILITY ENGINE
  // ==========================================================================

  async processAuditFiles(event) {
    try {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      const resultsBox = document.getElementById('auditResultsContainer');
      const container = document.getElementById('auditPreviewContent');
      
      if (resultsBox) resultsBox.style.display = 'block';
      if (container) container.innerHTML = '<div style="text-align:center; padding:20px; color:#0277bd; font-weight:bold;">⏳ Processing logs... Please wait.</div>';

      this.parsedAuditSessions = [];
      let filePromises = Array.from(files).map(file => {
        return new Promise((resolve) => {
          let reader = new FileReader();
          reader.onload = (e) => {
            try {
              let text = e.target.result;
              let sessionData = this.parseTXTExportContent(text, file.name);
              if (sessionData && sessionData.items && sessionData.items.length > 0) {
                this.parsedAuditSessions.push(sessionData);
              }
            } catch (err) {
              console.error("Error parsing file " + file.name + ":", err);
            }
            resolve();
          };
          reader.onerror = () => resolve();
          reader.readAsText(file);
        });
      });

      await Promise.all(filePromises);

      if (this.parsedAuditSessions.length > 0) {
        this.renderAuditPreviewUI();
      } else {
        if (container) container.innerHTML = '<div style="text-align:center; padding:20px; color:#c62828; font-weight:bold;">⚠️ Could not extract valid scanning data from the selected files.<br><br><span style="font-size:0.85rem; color:#555;">Ensure you are uploading .txt files exported directly from the ASP IMS app.</span></div>';
      }
      
      event.target.value = '';
    } catch (error) {
      alert("Error processing files: " + error.message);
    }
  },

  async batchPushLegacyLogs(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    let archive = JSON.parse(localStorage.getItem('asp_session_archive')) || [];
    let newUploads = 0;
    let skipped = 0;

    alert(`Starting cloud extraction for ${files.length} historical log(s). Please wait...`);

    let filePromises = Array.from(files).map((file, fileIdx) => {
      return new Promise((resolve) => {
        let reader = new FileReader();
        reader.onload = async (e) => {
          try {
            let text = e.target.result;
            let parsed = AuditManager.parseTXTExportContent(text, file.name);
            
            if (parsed && parsed.items && parsed.items.length > 0) {
              // Normalize Date to standard YYYY.MM.DD
              let rawDate = (parsed.date || '2026.01.01').trim();
              let dateParts = rawDate.split(/[\.\-\/]/);
              let normalizedDateStr = rawDate;
              if (dateParts.length === 3) {
                if (dateParts[0].length === 4) {
                  normalizedDateStr = `${dateParts[0]}.${dateParts[1].padStart(2, '0')}.${dateParts[2].padStart(2, '0')}`;
                } else {
                  normalizedDateStr = `${dateParts[2]}.${dateParts[0].padStart(2, '0')}.${dateParts[1].padStart(2, '0')}`;
                }
              }

              // Generate clean 13-digit numeric timestamp ID
              let baseTimestamp = new Date(normalizedDateStr.replace(/\./g, '-')).getTime();
              if (isNaN(baseTimestamp)) baseTimestamp = Date.now();
              // Offset slightly by file index to guarantee absolute uniqueness
              let cleanNumericId = (baseTimestamp + (fileIdx * 60000) + Math.floor(Math.random() * 1000)).toString();

              // Check deduplication against current archive
              let exists = archive.find(s => s.sessionName === parsed.sessionName && s.dateStr === normalizedDateStr);
              
              if (!exists) {
                let sessionObj = {
                  id: cleanNumericId,
                  status: 'Completed',
                  userName: (parsed.user && parsed.user !== 'N/A') ? parsed.user : 'Thomas',
                  sessionName: parsed.sessionName,
                  orderNum: '',
                  workflowType: parsed.workflow,
                  dateStr: normalizedDateStr,
                  startStr: 'Historical Import',
                  manifestEnabled: false,
                  expectedManifest: [],
                  scannedObjects: parsed.items.map(i => ({
                     actionTag: i.customerTag ? 'Reserved' : (i.workflow.includes('Pack') ? 'Pack & Ship' : 'Inventory'),
                     gtin: '',
                     ref: i.ref,
                     lot: i.lot,
                     exp: i.exp,
                     mfr: 'N/A', 
                     desc: 'Historical Import',
                     price: '$0.00',
                     qty: i.qty,
                     rawScanLines: [],
                     isNew: false,
                     customerTag: i.customerTag || '',
                     itemNote: i.itemNote || ''
                  })),
                  pendingNewItems: parsed.newItems || [],
                  pendingUpdates: parsed.updatedItems || [],
                  lastUpdated: baseTimestamp
                };
                
                archive.push(sessionObj);
                
                // Push to ASP_SCANNER_DATABASE backend
                await fetch(SessionManager.cloudArchiveUrl, {
                  method: 'POST',
                  mode: 'no-cors',
                  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                  body: JSON.stringify({ action: "ARCHIVE_SESSION", payload: sessionObj })
                });

                // Also push to Medline/Suture Orders backend
                // await fetch(SessionManager.googleFeederUrl, {
                //  method: 'POST',
                //  mode: 'no-cors',
                //  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                //  body: JSON.stringify({ action: "ARCHIVE_SESSION", payload: sessionObj })
                //});
                
                newUploads++;
              } else {
                skipped++;
              }
            }
          } catch (err) {
            console.error("Error parsing legacy file " + file.name + ":", err);
          }
          resolve();
        };
        reader.readAsText(file);
      });
    });

    await Promise.all(filePromises);
    
    // Sort archive newest first and save
    archive.sort((a,b) => b.lastUpdated - a.lastUpdated);
    localStorage.setItem('asp_session_archive', JSON.stringify(archive));
    
    alert(`☁️ Cloud Batch Upload Complete!\n\n✅ Successfully Pushed: ${newUploads}\n⏭️ Skipped (Already Existed): ${skipped}`);
    event.target.value = '';
  },

  clearAuditSessions() {
    this.parsedAuditSessions = [];
    document.getElementById('auditResultsContainer').style.display = 'none';
    document.getElementById('auditPreviewContent').innerHTML = '';
    document.getElementById('auditFilesUpload').value = '';
    alert("Audit session cache cleared! Ready to upload new logs.");
  },

  parseTXTExportContent(text, filename) {
    let sessionName = filename.replace(/\.txt$/i, ''), workflow = "General", date = "Unknown", user = "N/A";
    let items = [], newItems = [], updatedItems = [];
    let lines = text.split(/\r?\n/);
    let currentMode = "GENERAL";
    let tempRef = "", currentTag = "", currentItemNote = "";
    let currentObj = null;

    lines.forEach(line => {
      let trim = line.trim();
      if (!trim) return;

      if (trim.includes("ASP SCANNER APP SUMMARY EXPORT - ")) {
        sessionName = trim.replace("ASP SCANNER APP SUMMARY EXPORT - ", "").trim();
      } else if (trim.includes("ASP Inventory Management System Summary Export - ")) {
        sessionName = trim.replace("ASP Inventory Management System Summary Export - ", "").trim();
      } else if (trim.includes("Scanned By:")) {
        user = trim.split("Scanned By:")[1].trim();
      } else if (trim.includes("Workflow Process:")) {
        workflow = trim.split("Workflow Process:")[1].trim();
      } else if (trim.includes("Scanned Date:")) {
        date = trim.split("Scanned Date:")[1].trim();
      } else if (trim.includes("--- NEW ITEM DETAILS ---")) {
        currentMode = "NEW_ITEMS"; return;
      } else if (trim.includes("--- EXISTING ITEM UPDATES")) {
        currentMode = "UPDATES"; return;
      } else if (trim.includes("--- SCANNING SESSION FULL BARCODE REFERENCE DATA ---") || trim.includes("--- 1. MASTER ITEM CATALOG ---") || trim.includes("END OF RECEIVING INVENTORY SUMMARY")) {
        currentMode = "DONE"; return;
      }

      if (currentMode === "GENERAL") {
        if (trim.startsWith("[") && trim.includes("REF:")) {
          tempRef = trim.substring(trim.indexOf("REF:") + 4).trim().split(/\s+/)[0];
          currentTag = ""; 
          currentItemNote = "";
        } else if (trim.includes("Customer Tag:")) {
          let parts = trim.split("Customer Tag:");
          if (parts[1]) {
            currentTag = parts[1].split("(")[0].replace(/\|/g, '').trim();
          }
        } else if (trim.includes("Notes:")) {
          currentItemNote = trim.split("Notes:")[1].trim();
        } else if (trim.includes("Lot:") && trim.includes("Exp:") && tempRef) {
          let lotMatch = trim.match(/Lot:\s*([^|]+)\|\s*Exp:\s*([^|]+)\|\s*Qty:\s*(\d+)/i);
          if (lotMatch) {
            let lotVal = lotMatch[1].trim();
            let expVal = lotMatch[2].trim();
            let qtyVal = parseInt(lotMatch[3], 10) || 1;

            let effectiveWorkflow = workflow;
            if (workflow === "Unknown" || workflow === "General") {
              if (text.includes("--- PACK & SHIP ---") || text.includes("Picking & Packing")) effectiveWorkflow = "Picking & Packing";
              else if (text.includes("Receiving & Reserving")) effectiveWorkflow = "Receiving & Reserving";
              else if (text.includes("Reserving")) effectiveWorkflow = "Reserving";
              else if (text.includes("Receiving")) effectiveWorkflow = "Receiving";
            }

            items.push({
              ref: tempRef,
              lot: lotVal,
              exp: expVal,
              qty: qtyVal,
              customerTag: currentTag,
              itemNote: currentItemNote,
              workflow: effectiveWorkflow,
              sessionName: sessionName,
              fileName: filename,
              date: date,
              user: user
            });
          }
        }
      } else if (currentMode === "NEW_ITEMS") {
        if (trim.startsWith("[") && trim.includes("] REF:")) {
          let refPart = trim.substring(trim.indexOf("REF:") + 4).trim();
          currentObj = { ref: refPart.split(/\s+/)[0], gtin: "", mfr: "", price: "$0.00" };
          newItems.push(currentObj);
        } else if (currentObj && trim.includes("GTIN:")) {
          currentObj.gtin = trim.split("GTIN:")[1].trim();
        } else if (currentObj && trim.includes("Manufacturer:")) {
          currentObj.mfr = trim.split("Manufacturer:")[1].trim();
        } else if (currentObj && trim.includes("Price:")) {
          currentObj.price = trim.split("Price:")[1].trim();
        }
      } else if (currentMode === "UPDATES") {
        if (trim.startsWith("[") && trim.includes("] REF:")) {
          let refPart = trim.substring(trim.indexOf("REF:") + 4).trim();
          currentObj = { ref: refPart.split(/\s+/)[0], gtin: "" };
          updatedItems.push(currentObj);
        } else if (currentObj && trim.includes("GTIN:")) {
          currentObj.gtin = trim.split("GTIN:")[1].trim();
        }
      }
    });

    return items.length > 0 ? { fileName: filename, sessionName, workflow, date, user, items, newItems, updatedItems } : null;
  },

  compileTraceabilityData() {
    return this.cloudTraceData;
  },

  renderAuditPreviewUI() {
    const container = document.getElementById('auditPreviewContent');
    if (!container) return;

    const { sortedTraceList, totalItemsScanned, uniqueRefsCount, startDate, endDate, sourceFilesList } = this.compileTraceabilityData();
    
    let fileListHtml = sourceFilesList.map(f => `<li>${f}</li>`).join('');

    let inboundItems = [];
    let shelfItems = [];
    let reservedMap = {};
    let shippedItems = [];

    sortedTraceList.forEach(t => {
      if (t.inboundQty > 0) inboundItems.push(t);
      if (t.inboundQty > 0 && !t.reservedForTag && t.outboundQty === 0) shelfItems.push(t);
      if (t.reservedForTag) {
        let tag = t.reservedForTag;
        if (!reservedMap[tag]) reservedMap[tag] = [];
        reservedMap[tag].push(t);
      }
      if (t.outboundQty > 0) shippedItems.push(t);
    });

    let reservedBinsHtml = '';
    let resKeys = Object.keys(reservedMap);

    if (resKeys.length > 0) {
      resKeys.forEach(tag => {
        let rows = reservedMap[tag].map(r => {
          let remaining = r.reservedQty - r.outboundQty;
          let remBadge = remaining > 0 
            ? `<span style="color:#d32f2f; font-weight:bold;">${remaining}</span>` 
            : `<span style="color:#2e7d32; font-weight:bold;">✅ 0</span>`;
          
          return `
            <tr style="border-bottom: 1px solid #e0e0e0;">
              <td style="width:25%; padding:4px 6px; font-weight:bold; color:#0277bd;">${r.ref}</td>
              <td style="width:25%; padding:4px 6px;">${r.lot}</td>
              <td style="width:15%; padding:4px 6px; text-align:center; font-weight:bold; color:#0277bd;">${r.reservedQty}</td>
              <td style="width:15%; padding:4px 6px; text-align:center; font-weight:bold; color:${r.outboundQty >= r.reservedQty ? '#2e7d32' : '#555'};">${r.outboundQty}</td>
              <td style="width:20%; padding:4px 6px; text-align:center;">${remBadge}</td>
            </tr>`;
        }).join('');

        reservedBinsHtml += `
          <div style="background:#f0f8ff; border:1px solid #bfe0fb; border-radius:4px; padding:8px; margin-bottom:10px;">
            <div style="font-weight:bold; color:#0277bd; font-size:0.85rem; margin-bottom:6px; border-bottom:1px solid #bfe0fb; padding-bottom:3px;">
              Order / Customer: ${tag}
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:0.8rem; table-layout:fixed;">
              <thead>
                <tr style="text-align:left; color:#555; background:#e1f5fe;">
                  <th style="width:25%; padding:4px 6px;">REF</th>
                  <th style="width:25%; padding:4px 6px;">Lot</th>
                  <th style="width:15%; padding:4px 6px; text-align:center;">Reserved</th>
                  <th style="width:15%; padding:4px 6px; text-align:center;">Packed</th>
                  <th style="width:20%; padding:4px 6px; text-align:center; color:#d32f2f;">Remaining</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>`;
      });
    } else {
      reservedBinsHtml = '<div style="font-size:0.8rem; color:#777; padding:8px;">No active customer allocations found in uploaded logs.</div>';
    }

    let html = `
      <div class="audit-card" style="background-color:#e3f2fd; border-left:5px solid #0277bd; margin-bottom:15px;">
        <div class="flex-between">
          <h3 style="margin:0; color:#0277bd;">🗓️ Audit Period: ${startDate} – ${endDate}</h3>
          <span class="badge-info" style="background-color:#0277bd; color:#fff;">${this.parsedAuditSessions.length} Logs Processed</span>
        </div>
        <div style="margin-top:8px; font-size:0.9rem; line-height:1.4;">
          <strong>Unique REFs Handled:</strong> ${uniqueRefsCount} &nbsp;|&nbsp; 
          <strong>Total Units Moved:</strong> ${totalItemsScanned}
        </div>
        <details style="margin-top:10px; font-size:0.8rem; color:#555;">
          <summary style="cursor:pointer; font-weight:bold; color:#0277bd;">📁 View Audited Source Logs (${sourceFilesList.length})</summary>
          <ul style="margin:6px 0 0 16px; padding:0; max-height:90px; overflow-y:auto;">${fileListHtml}</ul>
        </details>
      </div>

      <div class="card" style="border-left: 5px solid #2e7d32; margin-bottom: 12px;">
        <h3 style="color:#2e7d32; margin:0 0 8px 0; font-size:1rem;">📥 Inbound Stock Received (${inboundItems.reduce((acc, c) => acc + c.inboundQty, 0)} Units)</h3>
        <div style="max-height: 200px; overflow-y: auto;">
          <table style="width:100%; border-collapse:collapse; font-size:0.8rem; table-layout:fixed;">
            <thead>
              <tr style="background:#e8f5e9; text-align:left;">
                <th style="width:25%; padding:4px 6px;">REF</th>
                <th style="width:25%; padding:4px 6px;">Lot</th>
                <th style="width:20%; padding:4px 6px;">Exp</th>
                <th style="width:15%; padding:4px 6px; text-align:center;">Qty</th>
                <th style="width:15%; padding:4px 6px;">Received</th>
              </tr>
            </thead>
            <tbody>
              ${inboundItems.map(i => `
                <tr style="border-bottom:1px solid #eee;">
                  <td style="padding:4px 6px; font-weight:bold; color:#0277bd;">${i.ref}</td>
                  <td style="padding:4px 6px;">${i.lot}</td>
                  <td style="padding:4px 6px;">${i.exp}</td>
                  <td style="padding:4px 6px; text-align:center; font-weight:bold;">${i.inboundQty}</td>
                  <td style="padding:4px 6px;">${i.receivedDate}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card" style="border-left: 5px solid #0277bd; margin-bottom: 12px;">
        <h3 style="color:#0277bd; margin:0 0 8px 0; font-size:1rem;">🚩 Active Reserved Bins (Allocated Orders)</h3>
        ${reservedBinsHtml}
      </div>

      <div class="card" style="border-left: 5px solid #e65100; margin-bottom: 12px;">
        <h3 style="color:#e65100; margin:0 0 8px 0; font-size:1rem;">🖐️ Outbound Orders Shipped (${shippedItems.reduce((acc, c) => acc + c.outboundQty, 0)} Units)</h3>
        <div style="max-height: 200px; overflow-y: auto;">
          <table style="width:100%; border-collapse:collapse; font-size:0.8rem; table-layout:fixed;">
            <thead>
              <tr style="background:#fff3e0; text-align:left;">
                <th style="width:30%; padding:4px 6px;">REF</th>
                <th style="width:30%; padding:4px 6px;">Lot</th>
                <th style="width:20%; padding:4px 6px;">Exp</th>
                <th style="width:20%; padding:4px 6px; text-align:center;">Qty Shipped</th>
              </tr>
            </thead>
            <tbody>
              ${shippedItems.map(s => `
                <tr style="border-bottom:1px solid #eee;">
                  <td style="padding:4px 6px; font-weight:bold; color:#0277bd;">${s.ref}</td>
                  <td style="padding:4px 6px;">${s.lot}</td>
                  <td style="padding:4px 6px;">${s.exp}</td>
                  <td style="padding:4px 6px; text-align:center; font-weight:bold; color:#e65100;">${s.outboundQty}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.innerHTML = html;
  },

  buildHTMLAuditReportString(filename, startDate, endDate) {
    const { sortedTraceList, totalItemsScanned, uniqueRefsCount, sourceFilesList } = this.compileTraceabilityData();

    let inventoryStockList = [];
    let customerGroupMap = {};
    let generalOutboundList = [];

    sortedTraceList.forEach(trace => {
      if (trace.reservedForTag) {
        let tag = trace.reservedForTag;
        if (!customerGroupMap[tag]) customerGroupMap[tag] = [];
        customerGroupMap[tag].push(trace);
      } else if (trace.inboundQty > 0) {
        inventoryStockList.push(trace);
      } else if (trace.outboundQty > 0) {
        generalOutboundList.push(trace);
      }
    });

    let fileItemsHtml = sourceFilesList.map(f => `<div style="font-size:10px; color:#555;">• ${f}</div>`).join('');

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${filename}</title>
<style>
body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; margin: 30px; font-size: 12px; }
.header-grid { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0277bd; padding-bottom: 15px; margin-bottom: 15px; }
.company-info h1 { margin: 0; color: #0277bd; font-size: 20px; text-transform: uppercase; }
.company-info p { margin: 2px 0; color: #555; }
.report-meta { text-align: right; }
.report-meta h2 { margin: 0; color: #333; font-size: 15px; margin-bottom: 6px; }
.report-meta table { width: 100%; text-align: right; border: none; font-size: 11px; margin: 0; }
.report-meta td { border: none; padding: 1px 0 1px 10px; }
.file-log-box { background: #f4eeda; border: 1px solid #8b8589; border-radius: 4px; padding: 8px 12px; margin-bottom: 15px; }
.file-log-box h4 { margin: 0 0 4px 0; color: #0277bd; font-size: 11px; text-transform: uppercase; }
.section-title { background-color: #f0f0f0; border-left: 5px solid #0277bd; padding: 6px 10px; font-size: 13px; font-weight: bold; margin: 20px 0 10px 0; text-transform: uppercase; }
.sub-section-title { background-color: #e3f2fd; border-left: 4px solid #0277bd; padding: 4px 8px; font-size: 12px; font-weight: bold; margin: 12px 0 6px 0; color: #0277bd; }
.audit-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 11px; }
.audit-table th { background-color: #fafafa; border: 1px solid #ccc; padding: 6px; text-align: center; color: #333; font-size: 11px; }
.audit-table td { border: 1px solid #eee; padding: 6px; vertical-align: middle; text-align: center; }
.ref-col { font-weight: bold; color: #0277bd; text-align: left; }
.desc-col { text-align: left; font-size: 10px; color: #555; }
.timeline-text { font-family: monospace; font-size: 10px; text-align: left; background: #f9f9f9; padding: 4px; border-radius: 3px; }
@media print {
  body { margin: 0; padding: 10px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page-break { page-break-before: always; }
}
</style>
</head>
<body>
<div class="header-grid">
<div>
  <img src="ASP_Box_Web_RGB.png" style="max-height: 65px;" alt="ASP Logo" />
</div>
<div class="company-info" style="margin-left: 20px;">
  <h1>Allied Surgical Products</h1>
  <p>737 Barbara Street | Palm Harbor, FL 34684</p>
</div>
<div class="report-meta">
  <h2>SHIPPING & RECEIVING WEEKLY SUMMARY</h2>
  <table>
    <tr><td><strong>Date Range:</strong></td><td>${startDate} - ${endDate}</td></tr>
    <tr><td><strong>Sessions Audited:</strong></td><td>${this.parsedAuditSessions.length} Logs</td></tr>
    <tr><td><strong>Unique REFs:</strong></td><td>${uniqueRefsCount}</td></tr>
    <tr><td><strong>Total Units Handled:</strong></td><td>${totalItemsScanned}</td></tr>
  </table>
</div>
</div>

<div class="file-log-box">
  <h4>AUDITED SOURCE LOG FILES (${sourceFilesList.length})</h4>
  <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 4px;">
    ${fileItemsHtml}
  </div>
</div>

<div class="section-title">1. MASTER CATALOG & INVENTORY ITEMS</div>
<table class="audit-table">
<thead>
  <tr>
    <th>REF</th>
    <th>Manufacturer</th>
    <th>Description</th>
    <th>Lot</th>
    <th>Exp</th>
    <th>Qty</th>
    <th>Price</th>
    <th>GTIN</th>
  </tr>
</thead>
<tbody>`;

    sortedTraceList.forEach(t => {
      html += `
        <tr>
          <td class="ref-col">${t.ref}</td>
          <td>${t.mfr}</td>
          <td class="desc-col">${t.desc}</td>
          <td>${t.lot}</td>
          <td>${t.exp}</td>
          <td><strong>${t.inboundQty || t.outboundQty || t.reservedQty}</strong></td>
          <td>${t.price}</td>
          <td style="font-family:monospace; font-size:10px;">${this.cleanGtinValue(t.gtin)}</td>
        </tr>
      `;
    });

    html += `</tbody></table>

<div class="section-title">2. RECEIVING & ALLOCATION STATUS</div>
<table class="audit-table">
<thead>
  <tr>
    <th>REF</th>
    <th>Lot</th>
    <th>Exp</th>
    <th>Total Qty</th>
    <th>Damaged Qty</th>
    <th>Received Date</th>
    <th>Reserved Qty</th>
    <th>Reserved For</th>
    <th>Packed Qty</th>
  </tr>
</thead>
<tbody>`;

    sortedTraceList.forEach(t => {
      let dmgStr = t.damagedQty > 0 ? `<span style="color:#d32f2f; font-weight:bold;">${t.damagedQty}</span>` : '0';
      let resQtyStr = t.reservedQty > 0 ? t.reservedQty : '--';
      let resForStr = t.reservedForTag ? t.reservedForTag : '--';

      html += `
        <tr>
          <td class="ref-col">${t.ref}</td>
          <td>${t.lot}</td>
          <td>${t.exp}</td>
          <td><strong>${t.inboundQty || t.outboundQty || t.reservedQty}</strong></td>
          <td>${dmgStr}</td>
          <td>${t.receivedDate}</td>
          <td>${resQtyStr}</td>
          <td>${resForStr}</td>
          <td>${t.outboundQty || '--'}</td>
        </tr>
      `;
    });

    html += `</tbody></table>

<div class="page-break"></div>
<div class="section-title">3. LIFECYCLE TRACEABILITY FLOW (CHRONOLOGICAL)</div>`;

    if (inventoryStockList.length > 0) {
      html += `<div class="sub-section-title">📦 Received to General Stock Inventory</div>
      <table class="audit-table">
      <thead><tr><th style="width:20%;">REF & Lot</th><th style="width:20%;">Received Date / Qty</th><th style="width:60%;">Chronological Lifecycle Timeline</th></tr></thead><tbody>`;
      
      inventoryStockList.forEach(t => {
        let timelineStr = t.timeline.map(ev => `• <strong>${ev.date}</strong> - ${ev.workflow}: ${ev.qty} unit(s) [${ev.sessionName}]`).join('<br>');
        html += `<tr><td class="ref-col">${t.ref}<br><span style="font-weight:normal; color:#555;">Lot: ${t.lot}</span></td><td>${t.receivedDate}<br><strong>Qty: ${t.inboundQty}</strong></td><td class="timeline-text">${timelineStr}</td></tr>`;
      });
      html += `</tbody></table>`;
    }

    if (Object.keys(customerGroupMap).length > 0) {
      html += `<div class="sub-section-title">🚩 Customer Allocations & Reserved Bins</div>`;
      for (let custTag in customerGroupMap) {
        html += `<div style="font-weight:bold; margin:6px 0 2px 0; color:#0277bd;">Customer Order: ${custTag}</div>
        <table class="audit-table">
        <thead><tr><th style="width:20%;">REF & Lot</th><th style="width:20%;">Reserved vs Packed</th><th style="width:60%;">Chronological Lifecycle Timeline</th></tr></thead><tbody>`;

        customerGroupMap[custTag].forEach(t => {
          let timelineStr = t.timeline.map(ev => `• <strong>${ev.date}</strong> - ${ev.workflow}: ${ev.qty} unit(s) [${ev.sessionName}]`).join('<br>');
          html += `<tr><td class="ref-col">${t.ref}<br><span style="font-weight:normal; color:#555;">Lot: ${t.lot}</span></td><td>Reserved: <strong>${t.reservedQty}</strong><br>Packed: <strong>${t.outboundQty}</strong></td><td class="timeline-text">${timelineStr}</td></tr>`;
        });
        html += `</tbody></table>`;
      }
    }

    if (generalOutboundList.length > 0) {
      html += `<div class="sub-section-title">🖐️ General Outbound Shipments</div>
      <table class="audit-table">
      <thead><tr><th style="width:20%;">REF & Lot</th><th style="width:20%;">Packed Qty</th><th style="width:60%;">Chronological Lifecycle Timeline</th></tr></thead><tbody>`;
      
      generalOutboundList.forEach(t => {
        let timelineStr = t.timeline.map(ev => `• <strong>${ev.date}</strong> - ${ev.workflow}: ${ev.qty} unit(s) [${ev.sessionName}]`).join('<br>');
        html += `<tr><td class="ref-col">${t.ref}<br><span style="font-weight:normal; color:#555;">Lot: ${t.lot}</span></td><td><strong>Qty: ${t.outboundQty}</strong></td><td class="timeline-text">${timelineStr}</td></tr>`;
      });
      html += `</tbody></table>`;
    }

    html += `</body></html>`;
    return html;
  },

  executeAuditExport() {
    const val = document.getElementById('auditExportDropdown').value;
    if (!val) { alert("Please select an audit export format."); return; }

    const { sortedTraceList, totalItemsScanned, uniqueRefsCount, startDate, endDate, sourceFilesList } = this.compileTraceabilityData();
    const filename = `ASP - Shipping & Receiving - Week Summary (${startDate}-${endDate}).${val}`;

    if (val === 'pdf') {
      let printWin = window.open('', '_blank');
      if (!printWin) { alert("Pop-up blocked! Please allow pop-ups to generate the PDF."); return; }

      let fileContent = this.buildHTMLAuditReportString(filename, startDate, endDate);
      printWin.document.open();
      printWin.document.write(fileContent);
      printWin.document.close();

      printWin.onload = () => {
        setTimeout(() => {
          printWin.focus();
          printWin.print();
        }, UIManager.printTimeout);
      };
      return;
    }

    let reportText = [
      `================================================================================`,
      `ASP - Shipping & Receiving - Week Summary (${startDate}-${endDate})`,
      `Generated Date: ${SessionManager.sessionDateStr}`,
      `Total Uploaded Sessions: ${this.parsedAuditSessions.length}`,
      `Total Unique REFs: ${uniqueRefsCount}`,
      `Total Units Handled: ${totalItemsScanned}`,
      `================================================================================`,
      `AUDITED SOURCE LOG FILES (${sourceFilesList.length}):`,
      sourceFilesList.map(f => `  • ${f}`).join('\n'),
      `================================================================================\n`,
      `--- 1. MASTER ITEM CATALOG ---\n`
    ];

    sortedTraceList.forEach(t => {
      reportText.push(`Ref: ${t.ref} | Mfr: ${t.mfr} | Lot: ${t.lot} | Exp: ${t.exp} | Qty: ${t.inboundQty || t.outboundQty || t.reservedQty} | Price: ${t.price} | GTIN: ${this.cleanGtinValue(t.gtin)}`);
    });

    reportText.push(`\n--------------------------------------------------------------------------------`);
    reportText.push(`--- 2. RECEIVING & ALLOCATION STATUS ---\n`);

    sortedTraceList.forEach(t => {
      let line = `Ref: ${t.ref} | Lot: ${t.lot} | Exp: ${t.exp} | Qty: ${t.inboundQty || t.outboundQty || t.reservedQty}`;
      if (t.damagedQty > 0) line += ` | Damaged Qty: ${t.damagedQty}`;
      if (t.receivedDate !== 'N/A') line += ` | Received Date: ${t.receivedDate}`;
      if (t.reservedQty > 0) line += ` | Reserved Qty: ${t.reservedQty} | Reserved for: ${t.reservedForTag}`;
      line += ` | Packed Qty: ${t.outboundQty}`;
      reportText.push(line);
    });

    reportText.push(`\n--------------------------------------------------------------------------------`);
    reportText.push(`--- 3. LIFECYCLE TRACEABILITY FLOW (CHRONOLOGICAL) ---\n`);

    sortedTraceList.forEach(t => {
      reportText.push(`Ref: ${t.ref}    |    Lot: ${t.lot}    |    Exp: ${t.exp}    |    Qty: ${t.inboundQty || t.outboundQty || t.reservedQty}`);
      if (t.receivedDate !== 'N/A') reportText.push(`             |    Received: ${t.receivedDate}`);
      if (t.reservedQty > 0) reportText.push(`             |    Reserved Qty: ${t.reservedQty}    |    Reserved for: ${t.reservedForTag}`);
      reportText.push(`             |    Timeline History:`);
      t.timeline.forEach(ev => {
        let tagStr = ev.customerTag ? ` [Tag: ${ev.customerTag}]` : '';
        reportText.push(`                 - [${ev.date}] ${ev.workflow}: ${ev.qty} unit(s) via ${ev.sessionName}${tagStr}`);
      });
      reportText.push(``);
    });

    reportText.push(`================================================================================\nEND OF WEEKLY SUMMARY\n================================================================================`);
    
    UIManager.triggerShareOrDownload(reportText.join('\n'), filename, 'text/plain');
  },

  exportEcommerceData(platform, isNew) {
    let db = (typeof DatabaseManager !== 'undefined' && DatabaseManager.db) ? DatabaseManager.db : [];
    
    let filtered = db.filter(item => {
      let flag = platform === 'Thrive' ? String(item.syncedThrive).toUpperCase() : String(item.syncedShopify).toUpperCase();
      let matchesFlag = isNew ? flag !== 'TRUE' : flag === 'TRUE';
      
      // Exclude UOM Bundles from New Item Creations
      // A UOM Bundle is identified by having a parentRef and a multiplier > 1
      if (isNew && item.parentRef && parseInt(item.uomMult, 10) > 1) {
          return false;
      }
      
      return matchesFlag;
    });

    if (filtered.length === 0) { alert(`No items found for ${platform} (${isNew ? 'New' : 'Updates'}).`); return; }

    let csvContent = '';

    // ========================================================
    // THRIVE BULK EDIT PRODUCTS (UPDATES TEMPLATE)
    // ========================================================
    if (platform === 'Thrive' && !isNew) {
      // 25-column exact match to Thrive Bulk Edit Export
      let headers = ['ID', 'Product Name', 'New Product Name', 'Product Categories', 'New Product Categories', 'Product Description', 'New Product Description', 'Shipping Width', 'New Shipping Width', 'Shipping Length', 'New Shipping Length', 'Shipping Height', 'New Shipping Height', 'Shipping Dimension Unit (in, cm)', 'New Shipping Dimension Unit (in, cm)', 'Shipping Weight', 'New Shipping Weight', 'Shipping Weight Unit (g, oz, lb, kg)', 'New Shipping Weight Unit (g, oz, lb, kg)', 'Active (ACTIVE, INACTIVE)', 'New Active (ACTIVE, INACTIVE)', 'PH Warehouse Enabled', 'New PH Warehouse Enabled', 'PH Warehouse - (Shopify) PH Warehouse Enabled', 'New PH Warehouse - (Shopify) PH Warehouse Enabled'];
      csvContent += headers.join(',') + '\n';

      // Sort alphabetically by REF to match Thrive's default export sorting
      filtered.sort((a, b) => (a.ref || a.sku || '').localeCompare(b.ref || b.sku || ''));

      filtered.forEach(item => {
        let ref = String(item.ref || item.sku || '').replace(/"/g, '""');
        let desc = String(item.desc || '').replace(/[\r\n]+/g, ' ').replace(/"/g, '""');
        let cat = String(item.category || '').replace(/"/g, '""');
        let cleanPrice = parseFloat(String(item.price || '').replace(/[^0-9.-]+/g, '')) || 0;
        let activeStatus = (item.status === 'INACTIVE' || cleanPrice === 0) ? 'INACTIVE' : 'ACTIVE';
        
        // Leaves ID blank. You can copy the 'New Product Categories', 'New Product Description', and 'New Active' columns directly into your downloaded Thrive file.
        csvContent += `,"${ref}","","${cat}","","${desc}","","","","","","","","","","","","","","${activeStatus}","","ENABLED","","ENABLED",""\n`;
      });
      
    // ========================================================
    // STANDARD NEW ITEMS CREATION (THRIVE & SHOPIFY)
    // ========================================================
    } else {
      let headers = ['REF', 'Manufacturer', 'Description', 'GTIN', 'Price', 'Cost', 'Available Qty', 'Categories'];
      csvContent += headers.join(',') + '\n';

      filtered.forEach(item => {
        let ref = String(item.ref || item.sku || '').replace(/"/g, '""');
        let mfr = String(item.mfr || '').replace(/"/g, '""');
        let desc = String(item.desc || '').replace(/[\r\n]+/g, ' ').replace(/"/g, '""');
        let gtin = String(item.gtin || '').replace(/"/g, '""').trim();
        let price = String(item.price || '').replace(/"/g, '""');
        let cost = String(item.cost || '').replace(/"/g, '""');
        let cat = String(item.category || '').replace(/"/g, '""');
        
        let avail = (parseInt(item.onHand || 0, 10)) - (parseInt(item.reservedQty || 0, 10));
        csvContent += `"${ref}","${mfr}","${desc}","${gtin}","${price}","${cost}",${avail},"${cat}"\n`;
      });
    }

    let dateStr = new Date().toLocaleDateString().replace(/\//g, '.');
    UIManager.triggerShareOrDownload(csvContent, `${platform}_${isNew ? "New_Items" : "Bulk_Edit_Template"}_Export_${dateStr}.csv`, 'text/csv');
    
    if (isNew && confirm(`Export complete!\n\nWould you like to automatically mark these ${filtered.length} items as "Synced with ${platform}" in your database?`)) {
        filtered.forEach(item => {
            if (platform === 'Thrive') item.syncedThrive = 'TRUE';
            if (platform === 'Shopify') item.syncedShopify = 'TRUE';
        });
        localStorage.setItem('asp_wh_db', JSON.stringify(DatabaseManager.db));
        alert(`Database updated locally. Please remember to click "Upload Pending Data" in the DB Editor to push these new flags to the cloud!`);
    }
  },

  exportUpdatedDatabaseJSON() {
    let currentDB = JSON.parse(localStorage.getItem('asp_wh_db')) || [];
    let currentVendors = JSON.parse(localStorage.getItem('asp_wh_vendors')) || [];
    let currentCustomers = JSON.parse(localStorage.getItem('asp_wh_customers')) || [];
    let currentSuppliers = JSON.parse(localStorage.getItem('asp_wh_suppliers')) || [];
    let newItemsMap = new Map(), updatesMap = new Map();
    
    this.parsedAuditSessions.forEach(sess => {
      (sess.newItems || []).forEach(item => newItemsMap.set(item.ref, item));
      (sess.updatedItems || []).forEach(item => updatesMap.set(item.ref, item));
    });

    currentDB.forEach(dbItem => {
      let refKey = (dbItem.sku || dbItem.ref || '').toUpperCase();
      if(updatesMap.has(refKey)) {
        let update = updatesMap.get(refKey);
        if(update.gtin && update.gtin !== 'N/A') dbItem.gtin = update.gtin;
      }
    });

    newItemsMap.forEach(newItem => {
      let exists = currentDB.find(i => (i.sku || i.ref || '').toUpperCase() === newItem.ref);
      if(!exists) {
        currentDB.push({ gtin: newItem.gtin === 'N/A' ? '' : newItem.gtin, ref: newItem.ref, desc: "", price: newItem.price || "$0.00", mfr: newItem.mfr });
      }
    });

    // ✨ FIX: Bundle all four arrays into the final JSON export
    let outJSON = { 
        customers: currentCustomers,
        suppliers: currentSuppliers,
        vendors: currentVendors, 
        items: currentDB 
    };
    UIManager.triggerShareOrDownload(JSON.stringify(outJSON, null, 2), `database_updated_${Date.now()}.json`, 'application/json');
  },

 openRestoreModal() {
    let dir = JSON.parse(localStorage.getItem('asp_cloud_directory')) || [];
    
    // Filter out subsequent parts from the dropdown, only show Part 1 or un-split sessions
    let stocktakes = dir.filter(s => {
        let isStocktake = (s.sessionName.includes('FULL-INV') || s.sessionName.includes('Stocktake')) && s.status === 'Completed';
        let isSubsequentPart = s.sessionName.match(/Part [2-9]/i) || s.sessionName.match(/\(Part [2-9]+ of/i);
        return isStocktake && !isSubsequentPart;
    }).sort((a,b) => parseInt(b.id) - parseInt(a.id));

    if (stocktakes.length === 0) {
      UIManager.showCustomAlert("Restore Failed", "No 'Full Stocktake' sessions found in the Cloud Vault.");
      return;
    }

    let optionsHtml = stocktakes.map(s => `<option value="${s.id}">${s.dateStr} - ${s.sessionName}</option>`).join('');

    let modal = document.createElement('div');
    modal.id = 'systemRestoreModal';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:99999; display:flex; justify-content:center; align-items:center; padding:15px; box-sizing:border-box;';
    
    modal.innerHTML = `
      <div style="background:#fff; border-radius:8px; width:100%; max-width:450px; padding:20px; box-shadow:0 4px 20px rgba(0,0,0,0.5);">
        <h3 style="margin:0 0 10px 0; color:#c62828; border-bottom:2px solid #c62828; padding-bottom:8px;">☁️ Cloud System Restore</h3>
        <p style="font-size:0.85rem; color:#555;">Select a historical stocktake below. The system will download the required payloads from the Cloud Vault and mathematically replay all subsequent sessions to rebuild your inventory.</p>
        
        <select id="restoreBaselineSelect" style="width:100%; padding:10px; font-weight:bold; margin-bottom:20px; border:2px solid #c62828;">
          ${optionsHtml}
        </select>

        <div style="display:flex; justify-content:space-between; gap:10px;">
          <button onclick="document.getElementById('systemRestoreModal').remove()" style="flex:1; background:#757575; color:#fff; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancel</button>
          <button onclick="AuditManager.executeCloudEventReplay()" style="flex:1; background:#c62828; color:#fff; border:none; padding:10px; border-radius:4px; font-weight:bold; cursor:pointer;">⚠️ Execute Replay</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  async executeCloudEventReplay() {
    let baselineId = document.getElementById('restoreBaselineSelect').value;
    let dir = JSON.parse(localStorage.getItem('asp_cloud_directory')) || [];
    
    let baselineLite = dir.find(s => String(s.id) === String(baselineId));
    if (!baselineLite) return;

    if (!confirm(`Are you absolutely sure you want to rebuild the database starting from the cloud baseline on ${baselineLite.dateStr}?`)) return;

    document.getElementById('systemRestoreModal').remove();
    
    // Show detailed downloading overlay with scrolling console
    let overlay = document.createElement('div');
    overlay.id = 'replayOverlay';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.95); z-index:99999; display:flex; flex-direction:column; justify-content:center; align-items:center; padding:20px; box-sizing:border-box;';
    overlay.innerHTML = `
      <div style="background:#fff; border-radius:8px; width:100%; max-width:600px; padding:20px; display:flex; flex-direction:column; height:80vh; box-shadow:0 4px 20px rgba(0,0,0,0.5);">
        <h3 style="margin:0 0 15px 0; color:#c62828; text-align:center; border-bottom:2px solid #c62828; padding-bottom:8px;">⏪ System Restore in Progress</h3>
        
        <div style="margin-bottom:10px; text-align:center; font-weight:bold; color:#0277bd;" id="replayStatusTitle">Initializing Connection...</div>
        
        <div style="width:100%; background:#eee; border-radius:4px; height:12px; overflow:hidden; margin-bottom:15px; flex-shrink:0;">
          <div id="replayProgressBar" style="width:0%; height:100%; background:#c62828; transition:width 0.2s ease;"></div>
        </div>
        
        <div id="replayDetailedLog" style="flex:1; background:#1a1d20; color:#00e676; padding:10px; border-radius:4px; font-family:monospace; font-size:0.8rem; overflow-y:auto; border:2px solid #000; display:flex; flex-direction:column; gap:4px;">
          <!-- Logs injected here -->
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const logMsg = (msg, color = '#00e676') => {
      let logBox = document.getElementById('replayDetailedLog');
      if (logBox) {
        let div = document.createElement('div');
        div.style.color = color;
        div.textContent = `> ${msg}`;
        logBox.appendChild(div);
        logBox.scrollTop = logBox.scrollHeight;
      }
    };

    const updateProgress = (title, percent) => {
      let tEl = document.getElementById('replayStatusTitle');
      let pEl = document.getElementById('replayProgressBar');
      if (tEl) tEl.textContent = title;
      if (pEl) pEl.style.width = `${percent}%`;
    };

    try {
      logMsg(`Starting restore from baseline ID: ${baselineId}...`, '#64b5f6');
      
      // Identify sessions to replay (Sort chronologically by numeric ID)
      let sessionsToFetch = dir.filter(s => s.status === 'Completed' && parseInt(s.id) >= parseInt(baselineLite.id))
                               .sort((a,b) => parseInt(a.id) - parseInt(b.id));
      
      logMsg(`Found ${sessionsToFetch.length} chronological sessions to replay.`, '#64b5f6');
      
      let fullSessions = [];
      
      // Batch download payloads with Google Rate-Limit Throttling & Exponential Backoff
      for (let i = 0; i < sessionsToFetch.length; i++) {
        let sLite = sessionsToFetch[i];
        let pct = Math.floor((i / sessionsToFetch.length) * 40); // First 40% is downloading
        updateProgress(`Downloading payload ${i+1} of ${sessionsToFetch.length}...`, pct);
        logMsg(`Fetching: ${sLite.dateStr} - ${sLite.sessionName}...`);
        
        let success = false;
        let attempts = 0;
        let maxAttempts = 6;
        let waitTime = 5000; // Start with a 5-second penalty wait if blocked

        while (!success && attempts < maxAttempts) {
          try {
            let res = await fetch(`${SessionManager.getActiveArchiveUrl()}?action=GET_SESSION&id=${sLite.id}`);
            let rawText = (await res.text()).trim();
            
            // ✨ BULLETPROOF CHECK: If it doesn't start with { or [, it is an HTML error page
            if (!rawText.startsWith("{") && !rawText.startsWith("[")) {
              throw new Error("Google sent back an HTML Error Page instead of data.");
            }
            
            let sessionData = JSON.parse(rawText);
            
            if (sessionData && !sessionData.error) {
              fullSessions.push(sessionData);
              logMsg(`  ✓ Downloaded ${sessionData.scannedObjects ? sessionData.scannedObjects.length : 0} scanned items.`, '#fff');
              success = true; // Break the while loop
            } else {
               logMsg(`  ❌ FAILED: ${sessionData.message}`, '#ff5252');
               break; // Server responded with a valid JSON error, do not retry
            }
          } catch (fetchErr) {
            attempts++;
            if (attempts >= maxAttempts) {
               throw new Error(`Google is actively blocking the connection. Please wait 5 minutes and try the restore again.`);
            }
            logMsg(`  ⚠️ Google throttled connection (Attempt ${attempts}/5). Pausing ${waitTime/1000} seconds...`, '#ffeb3b');
            await new Promise(resolve => setTimeout(resolve, waitTime));
            waitTime += 3000; // Exponentially increase penalty wait (5s, 8s, 11s, 14s)
          }
        }
        
        // ✨ INCREASED STANDARD DELAY: Wait 2 full seconds between downloads to stay under quota
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      updateProgress(`Wiping current database quantities...`, 45);
      logMsg(`Wiping all active quantities from memory to prepare for baseline...`, '#ffb74d');

      // Wipe current quantities
      DatabaseManager.db.forEach(dbItem => {
        dbItem.onHand = 0;
        dbItem.reservedQty = 0;
      });
      let activeAllocations = {};

      updateProgress(`Rebuilding mathematical ledger...`, 50);

      // Replay history through the Engine
      for (let i = 0; i < fullSessions.length; i++) {
        let sess = fullSessions[i];
        let pct = 50 + Math.floor((i / fullSessions.length) * 40); // 50% to 90% is processing
        updateProgress(`Processing: ${sess.sessionName}...`, pct);
        
        logMsg(`[MATH] Processing ${sess.workflowType}: ${sess.sessionName} (${sess.dateStr})`, '#ffb74d');

        // ==========================================
        // LEGACY DATA TRANSFORMER
        // ==========================================
        let transformedScans = (sess.scannedObjects || []).map(item => {
           let tRef = (item.ref || item.sku || '').toUpperCase().trim();
           let tQty = parseInt(item.qty, 10) || 1;
           let tTag = (item.customerTag || '').toUpperCase().trim();
           let tOrder = (item.orderNum || '').toUpperCase().trim();
           let tAction = item.actionTag || '';
           let tSessionId = item.sessionId || '';

           // UOM Bundle Conversion
           let dbMatch = DatabaseManager.db.find(i => (i.sku || i.ref || '').toUpperCase() === tRef);
           if (dbMatch && dbMatch.parentRef && dbMatch.uomMult > 1) {
               tRef = dbMatch.parentRef.toUpperCase().trim();
               tQty = tQty * dbMatch.uomMult;
           }

           // Legacy Pick & Pack Missing Tags
           let wTypeUpper = (sess.workflowType || '').toUpperCase();
           let sNameUpper = (sess.sessionName || '').toUpperCase();
           if ((wTypeUpper.includes('PACKING') || wTypeUpper.includes('PACK & SHIP')) && !tTag) {
               tTag = sNameUpper;
           }

           // Split Concatenated Customer Tags & Orders (UPDATED: Force overwrite)
           if (tTag.includes(' - ')) {
               let parts = tTag.split(' - ');
               tTag = parts[0].trim();
               tOrder = parts[1].trim(); // Automatically overwrites the generic session order number
           } else if (tTag.includes('(')) {
               let match = tTag.match(/(.*?)\s*\((.*?)\)/);
               if (match) {
                   tTag = match[1].trim();
                   tOrder = match[2].trim(); // Automatically overwrites the generic session order number
               }
           }
           
           // Extra Fallback for 7b: If the sessionName itself was the tag, parse it
           if ((wTypeUpper.includes('PACKING') || wTypeUpper.includes('PACK & SHIP')) && tTag === sNameUpper) {
               if (sNameUpper.includes(' - ')) {
                   let parts = sNameUpper.split(' - ');
                   tTag = parts[0].trim();
                   tOrder = parts[1].trim(); // Automatically overwrites the generic session order number
               } else if (sNameUpper.includes('(')) {
                   let match = sNameUpper.match(/(.*?)\s*\((.*?)\)/);
                   if (match) {
                       tTag = match[1].trim();
                       tOrder = match[2].trim(); // Automatically overwrites the generic session order number
                   }
               }
           }

           // Fallback Session ID
           if (!tSessionId) {
               tSessionId = `${sess.dateStr} - ${sess.sessionName}`;
           }

           return {
               ...item,
               ref: tRef,
               qty: tQty,
               customerTag: tTag,
               orderNum: tOrder,
               actionTag: tAction,
               sessionId: tSessionId
           };
        });

        // USE THE TRANSFORMED DATA FOR THE MATH
        if (sess.workflowType && sess.workflowType.includes('Stocktake')) {
          let scannedTotals = {};
          transformedScans.forEach(item => {
            let ref = item.ref;
            if (!scannedTotals[ref]) scannedTotals[ref] = 0;
            scannedTotals[ref] += item.qty;
          });

          if (sess.workflowType === 'Full Stocktake') {
            logMsg(`  - Executing Full Stocktake wipe & overwrite...`, '#fff');
            DatabaseManager.db.forEach(dbItem => { dbItem.onHand = 0; dbItem.reservedQty = 0; });
          } else {
             logMsg(`  - Executing Targeted Selection Stocktake overwrite...`, '#fff');
            Object.keys(scannedTotals).forEach(ref => {
              let dbItem = DatabaseManager.db.find(i => (i.sku || i.ref || '').toUpperCase() === ref);
              if (dbItem) dbItem.onHand = 0;
            });
          }

          Object.keys(scannedTotals).forEach(ref => {
            let dbItem = DatabaseManager.db.find(i => (i.sku || i.ref || '').toUpperCase() === ref);
            if (dbItem) {
              dbItem.onHand = (dbItem.onHand || 0) + scannedTotals[ref];
              logMsg(`    = REF: ${ref} explicitly set to ${dbItem.onHand}`);
            }
          });
        } else {
          logMsg(`  - Committing standard ledger adjustments (${transformedScans.length} lines)...`, '#fff');
          let result = InventoryEngine.commitLedgerMath(transformedScans, DatabaseManager.db, activeAllocations, sess.workflowType);
          DatabaseManager.db = result.updatedDb;
          activeAllocations = result.updatedAllocations;
        }
      }

      updateProgress(`Syncing rebuilt ledger to the cloud...`, 95);
      logMsg(`Saving rebuilt universe to local memory...`, '#64b5f6');
      
      // Save the rebuilt universe
      localStorage.setItem('asp_wh_db', JSON.stringify(DatabaseManager.db));
      localStorage.setItem('asp_allocations', JSON.stringify(activeAllocations));
      
      if (SessionManager.getActiveArchiveUrl()) {
        logMsg(`Pushing database adjustments to Google Sheets...`, '#64b5f6');
        let dbPayload = { action: "SYNC_LOCAL_DB", payload: { items: DatabaseManager.db } };
        await fetch(SessionManager.getActiveArchiveUrl(), { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(dbPayload) });
        
        logMsg(`Pushing customer allocations to Google Sheets...`, '#64b5f6');
        SessionManager.syncAllocationsToCloud();
      }

      updateProgress(`Restore Complete!`, 100);
      logMsg(`✅ SYSTEM RESTORE 100% COMPLETE!`, '#ffff00');

      setTimeout(() => {
        document.body.removeChild(overlay);
        UIManager.showCustomAlert("Restore Complete", `✅ Database successfully rebuilt from the cloud!\n\nDownloaded and replayed ${fullSessions.length} historical sessions to establish exact current stock levels.`);
      }, 3500); // Leave it on screen for 3.5 seconds so you can read the final logs
      
    } catch(err) {
       logMsg(`FATAL ERROR: ${err.message}`, '#ff5252');
       let overlayEl = document.getElementById('replayOverlay');
       // Add a close button so you aren't trapped if it fails
       if (overlayEl) {
         overlayEl.innerHTML += `<button onclick="document.body.removeChild(this.parentElement)" style="background:#ff5252; color:#fff; border:none; padding:10px 20px; margin-top:20px; border-radius:4px; font-weight:bold; cursor:pointer;">Close Window</button>`;
       }
    }
  },

  async traceLotNumber() {
    let inputEl = document.getElementById('lotSearchInput');
    let resultsContainer = document.getElementById('lotTraceResults');
    if (!inputEl || !resultsContainer) return;

    let targetLot = inputEl.value.trim().toUpperCase();
    if (!targetLot) { alert("Please enter a Lot Number to trace."); return; }

    resultsContainer.innerHTML = '<div style="padding:15px; color:#0277bd; text-align:center;">⏳ Searching live cloud ledger...</div>';

    try {
      let res = await fetch(`${SessionManager.getActiveArchiveUrl()}?action=GET_AUDIT_LOG&t=${Date.now()}`);
      let text = await res.text();
      let responseData = JSON.parse(text);
      
      if (responseData.status !== "success" || !responseData.data) throw new Error("Failed to load audit log.");

      let auditLog = responseData.data;
      let foundEvents = [];

      auditLog.forEach(row => {
        let rLot = String(row['Lot'] || '').toUpperCase();
        if (rLot && rLot.includes(targetLot)) {
          foundEvents.push({
            sessionName: row['Session / Reason'] || "Unknown Session",
            workflow: row['Workflow'] || "Unknown Workflow",
            date: row['Timestamp'] || "Unknown Date",
            user: row['User'] || "Operator",
            qty: row['Qty Moved'],
            ref: row['REF / SKU'],
            actionTag: row['Destination / Action']
          });
        }
      });

      if (foundEvents.length === 0) {
        resultsContainer.innerHTML = `<div style="padding:15px; color:#c62828; background:#ffebee; border-radius:4px; text-align:center;">No records found matching Lot Number: <strong>${targetLot}</strong></div>`;
        return;
      }

      let html = `<div style="margin-top:10px; padding:10px; background:#e8f5e9; border:1px solid #4caf50; border-radius:4px;">
                    <h4 style="margin:0 0 8px 0; color:#2e7d32;">🔍 Trace Results for Lot: ${targetLot} (${foundEvents.length} events found)</h4>`;
      foundEvents.forEach(ev => {
        html += `<div style="background:#fff; padding:8px; margin-bottom:6px; border-radius:3px; border-left:4px solid #0277bd; font-size:0.85rem;">
                  <div><strong>REF:</strong> ${ev.ref} | <strong>Qty:</strong> ${ev.qty} | <strong>Action:</strong> ${ev.actionTag}</div>
                  <div><strong>Session:</strong> ${ev.sessionName} (${ev.workflow})</div>
                  <div style="color:#666;">Date: ${ev.date} | Operator: ${ev.user}</div>
                </div>`;
      });
      html += `</div>`;

      resultsContainer.innerHTML = html;
    } catch(err) {
      resultsContainer.innerHTML = `<div style="padding:15px; color:#c62828; background:#ffebee; border-radius:4px; text-align:center;">Error fetching trace data: ${err.message}</div>`;
    }
  },

  exportShopifyProducts() {
    let db = (typeof DatabaseManager !== 'undefined' && DatabaseManager.db) ? DatabaseManager.db : [];
    if (db.length === 0) { alert("No inventory data loaded in memory."); return; }

    let headers = ['Handle', 'Title', 'Description', 'Vendor', 'Product category', 'Status', 'SKU', 'Barcode', 'Option1 name', 'Option1 value', 'Price', 'Cost per item', 'Inventory tracker', 'Continue selling when out of stock'];
    let csvContent = headers.join(',') + '\n';

    db.forEach(item => {
      let ref = String(item.ref || item.sku || '').trim();
      if (!ref) return;

      let handle = ref.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, ''); 
      let safeDesc = String(item.desc || '').replace(/[\r\n]+/g, ' ').replace(/"/g, '""');
      let safeMfr = String(item.mfr || '').replace(/"/g, '""');
      let safeGtin = (!item.gtin || item.gtin === 'N/A') ? '' : String(item.gtin).replace(/"/g, '""');
      
      let cleanPrice = parseFloat(String(item.price || '').replace(/[^0-9.-]+/g, '')) || 0;
      let safePrice = cleanPrice > 0 ? cleanPrice.toFixed(2) : '';
      let safeCost = String(item.cost || '').replace(/[^0-9.-]+/g, '');
      
      let status = (item.status === 'INACTIVE' || cleanPrice === 0) ? 'draft' : 'active';
      let category = String(item.category || '').replace(/"/g, '""');

      let row = [
        `"${handle}"`,           
        `"${ref}"`,              
        `"${safeDesc}"`,         
        `"${safeMfr}"`,          
        `"${category}"`,         
        `"${status}"`,           
        `"${ref}"`,              
        `"${safeGtin}"`,         
        `"Title"`,               
        `"Default Title"`,       
        `"${safePrice}"`,        
        `"${safeCost}"`,         
        `"shopify"`,             
        `"DENY"`
      ];

      csvContent += row.join(',') + '\n';
    });

    UIManager.triggerShareOrDownload(csvContent, `Shopify_Products_Export_${SessionManager.sessionDateStr}.csv`, 'text/csv');
  },

  exportShopifyInventory() {
    let db = (typeof DatabaseManager !== 'undefined' && DatabaseManager.db) ? DatabaseManager.db : [];
    if (db.length === 0) { alert("No inventory data loaded in memory."); return; }

    let headers = ['Handle', 'Title', 'Option1 Name', 'Option1 Value', 'SKU', 'Location', 'On hand (new)'];
    let csvContent = headers.join(',') + '\n';

    db.forEach(item => {
      let ref = String(item.ref || item.sku || '').trim();
      if (!ref) return;

      let handle = ref.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, ''); 
      
      let total = parseInt(item.onHand || item.TotalQty, 10) || 0;
      let res = parseInt(item.reservedQty, 10) || 0;
      let available = total - res;

      let row = [
        `"${handle}"`,           
        `"${ref}"`,              
        `"Title"`,               
        `"Default Title"`,       
        `"${ref}"`,              
        `"PH Warehouse"`,        
        `${available}`           
      ];

      csvContent += row.join(',') + '\n';
    });

    UIManager.triggerShareOrDownload(csvContent, `Shopify_Inventory_Export_${SessionManager.sessionDateStr}.csv`, 'text/csv');
  }
};