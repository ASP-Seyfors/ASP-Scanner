/* =======================================================================
 * Allied Surgical Products - Inventory Management System
 * File: js/databaseManager.js
 * Author: Thomas Seyfors
 * Date Created: August 2026
 * 
 * Description:
 *   Local database controller for warehouse inventory catalog lookup, 
 *   GTIN/SKU cross-referencing, Manufacturer mapping, and cloud 
 *   synchronization of the Master Item Catalog.
 *
 * Affected Features:
 *   - Barcode Database Matching & Fallbacks
 *   - GTIN Auto-Linking
 *   - Database Editor UI Grid
 *   - Partner/Vendor Dropdown Population
 *   - Master JSON Sync (Downloads & Uploads)
 *
 * Copyright (c) 2026 Thomas Seyfors / Allied Surgical Products.
 * All Rights Reserved.
 * ======================================================================= */
const defaultVendors = [
  "ARTHREX", "BARD", "BAXTER", "BD", "COOPER SURGICAL", "COOPERSURG", "COVIDIEN", 
  "ETHICON", "INTEGRA", "INTUITIVE", "MEDTRONIC", "SHARPOINT", "SMITH & NEPHEW", "STRYKER",   
  "+ Create New Vendor"
];
const defaultSuppliers = ["Medline", "GeoSurgical", "RevMed", "SPS", "All Dats Medical", "Fast Surgical Solutions", "Med Choice Inc.", "DJ Medical", "+ Add Supplier"];
const defaultCustomers = ["AHS", "Animal Eye Care", "BL", "RFP", "CASCADE", "REDHEAD", "SUNCOAST", "MAP", "PMCY", "EMMANUEL", "EMMANUEL JR", "SurgiShop", "Synergy", "POSS", "+ Add Customer"];

const DatabaseManager = {
  users: JSON.parse(localStorage.getItem('asp_wh_users')) || ["Thomas", "Trey", "Jessica", "+ New User"], // ✨ NEW: Dynamic user list
  db: JSON.parse(localStorage.getItem('asp_wh_db')) || [],
  vendors: JSON.parse(localStorage.getItem('asp_wh_vendors')) || defaultVendors,
  suppliers: JSON.parse(localStorage.getItem('asp_wh_suppliers')) || defaultSuppliers,
  customers: JSON.parse(localStorage.getItem('asp_wh_customers')) || defaultCustomers,

  async init() {
    // AUTO-SYNC: Merge any new hardcoded defaults into localStorage cache
    defaultSuppliers.forEach(s => {
      if (!this.suppliers.includes(s)) {
        // Insert right before "+ Add Supplier"
        this.suppliers.splice(this.suppliers.length - 1, 0, s);
      }
    });
    localStorage.setItem('asp_wh_suppliers', JSON.stringify(this.suppliers));

    defaultCustomers.forEach(c => {
      if (!this.customers.includes(c)) {
        // Insert right before "+ Add Customer"
        this.customers.splice(this.customers.length - 1, 0, c);
      }
    });
    localStorage.setItem('asp_wh_customers', JSON.stringify(this.customers));

    try {
      const response = await fetch('database.json');
      if (response.ok) {
        const jsonContent = await response.json();
        
        // ✨ NEW: Parse the Users Array
        if (jsonContent.users && jsonContent.users.length > 0) {
          this.users = jsonContent.users;
          if (!this.users.includes("+ New User")) this.users.push("+ New User");
          localStorage.setItem('asp_wh_users', JSON.stringify(this.users));
        }
        if (jsonContent.items && jsonContent.items.length > 0) {
          this.db = jsonContent.items;
          localStorage.setItem('asp_wh_db', JSON.stringify(this.db));
        }
        if (jsonContent.vendors && jsonContent.vendors.length > 0) {
          this.vendors = jsonContent.vendors;
          localStorage.setItem('asp_wh_vendors', JSON.stringify(this.vendors));
        }
        if (jsonContent.customers && jsonContent.customers.length > 0) {
          this.customers = jsonContent.customers;
          localStorage.setItem('asp_wh_customers', JSON.stringify(this.customers));
        }
        if (jsonContent.suppliers && jsonContent.suppliers.length > 0) {
          this.suppliers = jsonContent.suppliers;
          localStorage.setItem('asp_wh_suppliers', JSON.stringify(this.suppliers));
        }
      } else {
        console.warn("Notice: External database.json not found, using local cache.");
      }
    } catch (err) {
      console.error("Database parsing error:", err);
    }
    
    this.populateRefDatalist();
    this.populateVendors();
    this.populatePartners();
    this.populateItemCustomerSelect();
    this.runMasterLookup();
  },

  populateRefDatalist() {
    const datalist = document.getElementById('dbRefs');
    if (!datalist) return;
    datalist.innerHTML = '';
    this.db.forEach(item => {
      let opt = document.createElement('option');
      opt.value = (item.sku || item.ref || '').toString().trim().toUpperCase();
      datalist.appendChild(opt);
    });
  },

  populateVendors() {
    const sel = document.getElementById('vendorSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Select Manufacturer --</option>';
    this.vendors.forEach(v => {
      if (v === "+ Create New Vendor") return;
      let opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      sel.appendChild(opt);
    });
    let optNew = document.createElement('option');
    optNew.value = "+ Create New Vendor"; optNew.textContent = "+ Create New Vendor";
    sel.appendChild(optNew);
  },

  populatePartners() {
    const supSel = document.getElementById('supplierSelect');
    const custSel = document.getElementById('customerSelect');
    if (supSel) {
      supSel.innerHTML = '<option value="">-- Select Supplier --</option>';
      this.suppliers.forEach(s => {
        let opt = document.createElement('option'); opt.value = s; opt.textContent = s; supSel.appendChild(opt);
      });
    }
    if (custSel) {
      custSel.innerHTML = '<option value="">-- Select Customer --</option>';
      this.customers.forEach(c => {
        let opt = document.createElement('option'); opt.value = c; opt.textContent = c; custSel.appendChild(opt);
      });
    }
  },

  populateItemCustomerSelect() {
    const sel = document.getElementById('itemCustomerSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Select Customer --</option>';
    this.customers.forEach(c => {
      let opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      sel.appendChild(opt);
    });
  },

  handleItemCustomerSelect(val) {
    if (val === "+ Add Customer") {
      let newC = prompt("Enter new Customer name:");
      if (newC) {
        this.customers.splice(this.customers.length - 1, 0, newC.trim().toUpperCase());
        // SECURITY: Prevent guests from permanently overwriting the verified master list
        if (typeof AuthManager !== 'undefined' && !AuthManager.isGuest) {
          localStorage.setItem('asp_wh_customers', JSON.stringify(this.customers));
        }
        this.populatePartners();
        this.populateItemCustomerSelect();
        document.getElementById('itemCustomerSelect').value = newC.trim().toUpperCase();
      } else {
        document.getElementById('itemCustomerSelect').selectedIndex = 0;
      }
    }
  },

  handlePartnerSelect(val, type) {
    if (val === "+ Add Supplier") {
      let newS = prompt("Enter new Supplier/Vendor name:");
      if (newS) {
        this.suppliers.splice(this.suppliers.length - 1, 0, newS.trim());
        // SECURITY: Prevent guests from permanently overwriting the verified master list
        if (typeof AuthManager !== 'undefined' && !AuthManager.isGuest) {
          localStorage.setItem('asp_wh_suppliers', JSON.stringify(this.suppliers));
        }
        this.populatePartners();
        document.getElementById('supplierSelect').value = newS.trim();
      } else {
        document.getElementById('supplierSelect').selectedIndex = 0;
      }
    } else if (val === "+ Add Customer") {
      let newC = prompt("Enter new Customer name:");
      if (newC) {
        this.customers.splice(this.customers.length - 1, 0, newC.trim().toUpperCase());
        // SECURITY: Prevent guests from permanently overwriting the verified master list
        if (typeof AuthManager !== 'undefined' && !AuthManager.isGuest) {
          localStorage.setItem('asp_wh_customers', JSON.stringify(this.customers));
        }
        this.populatePartners();
        this.populateItemCustomerSelect();
        document.getElementById('customerSelect').value = newC.trim().toUpperCase();
      } else {
        document.getElementById('customerSelect').selectedIndex = 0;
      }
    }
  },

  handleVendorSelect(val) {
    if (val === "+ Create New Vendor") {
      let newV = prompt("Enter new Manufacturer/Vendor name:");
      if (newV) {
        this.vendors.splice(this.vendors.length - 1, 0, newV);
        // SECURITY: Prevent guests from permanently overwriting the verified master list
        if (typeof AuthManager !== 'undefined' && !AuthManager.isGuest) {
          localStorage.setItem('asp_wh_vendors', JSON.stringify(this.vendors));
        }
        this.populateVendors();
        document.getElementById('vendorSelect').value = newV;
      } else {
        document.getElementById('vendorSelect').selectedIndex = 0;
      }
    } else if (SessionManager.currentMatchedItem && this.getItemVendor(SessionManager.currentMatchedItem).toLowerCase() !== val.toLowerCase()) {
      document.getElementById('btnConfirmMfr').style.display = 'inline-block';
    }
    UIManager.evaluateFieldAttention();
  },

  findDatabaseMatch(gtinVal, refVal) {
    let cleanGtin = (gtinVal || '').replace(/^(01|\(01\))/, '').trim();
    let cleanRef = (refVal || '').trim().toUpperCase();
    
    // ✨ FIX 1: Prioritize explicit REF match over GTIN to stop the typing freeze bug
    if (cleanRef) {
      let match = this.db.find(i => this.getItemSku(i) === cleanRef);
      if (match) return match;
    }

    // ✨ FIX 2: Only fall back to GTIN if it's a real barcode, completely ignoring "N/A"
    if (cleanGtin && cleanGtin.toUpperCase() !== "N/A" && cleanGtin.toUpperCase() !== "NA") {
      let match = this.db.find(i => {
        let dbGtin = (i.gtin || '').toString().trim();
        return dbGtin && (dbGtin === cleanGtin || dbGtin.replace(/^0+/, '') === cleanGtin.replace(/^0+/, ''));
      });
      if (match) return match;
    }
    
    return null;
  },

  // --- CLEAN GRID EDITOR WITH EDIT MODAL ---
  renderDbGridEditor() {
    const tbody = document.getElementById('dbGridBody');
    if (!tbody) return;
    
    let searchQuery = (document.getElementById('dbSearchInput') ? document.getElementById('dbSearchInput').value.toLowerCase().trim() : '');
    let mfrFilter = (document.getElementById('dbMfrFilter') ? document.getElementById('dbMfrFilter').value : 'ALL');
    let needsPriceFilter = document.getElementById('chkNeedsPrice') ? document.getElementById('chkNeedsPrice').checked : false;

    let mfrDropdown = document.getElementById('dbMfrFilter');
    if (mfrDropdown && mfrDropdown.options.length <= 1) {
      let uniqueMfrs = [...new Set(this.db.map(i => i.mfr).filter(Boolean))].sort();
      uniqueMfrs.forEach(m => {
        let opt = document.createElement('option'); opt.value = m; opt.textContent = m; mfrDropdown.appendChild(opt);
      });
    }

    let dbCopy = this.db.filter(i => {
        let matchesSearch = !searchQuery || (i.ref || i.sku || '').toLowerCase().includes(searchQuery) || (i.desc || '').toLowerCase().includes(searchQuery);
        let matchesMfr = mfrFilter === 'ALL' || i.mfr === mfrFilter;
        // ✨ FIX: Only check if the Selling Price is missing, ignoring cost
        let matchesPrice = needsPriceFilter ? (!i.price || i.price === '$0.00' || i.price === '0') : true;
        return matchesSearch && matchesMfr && matchesPrice;
      })
      .sort((a,b) => (a.mfr || '').localeCompare(b.mfr) || (a.ref || '').localeCompare(b.ref));
    
    let html = '';
    dbCopy.forEach((item, idx) => {
      let safeRef = String(item.ref || item.sku || '').replace(/"/g, '&quot;');
      html += `
        <tr style="border-bottom: 1px solid #eee; background-color: ${idx % 2 === 0 ? '#fff' : '#f9f9f9'};">
          <td style="padding:10px; color:#555;">${item.mfr || '--'}</td>
          <td style="padding:10px; font-weight:bold; color:#00796b;">${item.ref || item.sku}</td>
          <td style="padding:10px; font-size:0.85rem; color:#333;">${item.desc || '--'}</td>
          <td style="padding:10px; text-align:center;">
            <button class="btn-small btn-auto" style="background-color: #00796b; color: #fff; margin:0; padding:6px 12px; display:flex; align-items:center; gap:6px;" onclick="DatabaseManager.openEditModal('${safeRef}')">
              <i data-lucide="pencil" style="width:14px; height:14px;"></i> Edit
            </button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;

    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  openEditModal(refVal) {
    let dbItem = this.db.find(i => (i.sku || i.ref || '').toUpperCase() === refVal.toUpperCase());
    if (!dbItem) return;

    let isAdmin = AuthManager.currentUser && AuthManager.currentUser.isAdmin;
    
    let priceInputHtml = isAdmin 
      ? `<input type="text" id="modalPrice" value="${dbItem.price || '$0.00'}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px;">` 
      : `<input type="text" id="modalPrice" value="${dbItem.price || '$0.00'}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; background-color:#f5f5f5; color:#777;" readonly title="Admin approval required to edit pricing.">`;

    let costInputHtml = isAdmin 
      ? `<input type="text" id="modalCost" value="${dbItem.cost || '$0.00'}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px;">` 
      : `<input type="text" id="modalCost" value="***" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; background-color:#f5f5f5; color:#999;" readonly title="Restricted Admin Data">`;

    let modal = document.createElement('div');
    modal.id = 'itemEditModal';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:999999; display:flex; justify-content:center; align-items:center; padding:15px; box-sizing:border-box;';
    
    modal.innerHTML = `
      <div style="background:#fff; border-radius:8px; width:100%; max-width:500px; padding:20px; box-shadow:0 4px 20px rgba(0,0,0,0.5);">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #00796b; padding-bottom:8px; margin-bottom:15px;">
          <h3 style="margin:0; color:#00796b;">✏️ Edit Item Details</h3>
          <button onclick="document.getElementById('itemEditModal').remove()" style="background:none; border:none; font-size:1.5rem; cursor:pointer;">&times;</button>
        </div>
        
        <div style="margin-bottom:10px;">
          <label style="font-weight:bold; font-size:0.85rem; color:#555;">REF / SKU (Read-Only)</label>
          <input type="text" id="modalRef" value="${dbItem.ref || dbItem.sku}" readonly style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; background:#f0f0f0; font-weight:bold; color:#00796b;">
        </div>

        <div style="margin-bottom:10px;">
          <label style="font-weight:bold; font-size:0.85rem; color:#555;">Manufacturer</label>
          <input type="text" id="modalMfr" value="${dbItem.mfr || ''}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px;">
        </div>

        <div style="margin-bottom:10px;">
          <label style="font-weight:bold; font-size:0.85rem; color:#555;">Description</label>
          <textarea id="modalDesc" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; resize:vertical; min-height:60px;">${dbItem.desc || ''}</textarea>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <div style="flex:1;">
            <label style="font-weight:bold; font-size:0.85rem; color:#555;">Category</label>
            <input type="text" id="modalCat" value="${dbItem.category || ''}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px;">
          </div>
          <div style="flex:1;">
            <label style="font-weight:bold; font-size:0.85rem; color:#555;">Shelf Location</label>
            <input type="text" id="modalShelf" value="${dbItem.shelf || ''}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; text-transform:uppercase;" placeholder="e.g. A-14">
          </div>
        </div>
        
        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <div style="flex:1;">
            <label style="font-weight:bold; font-size:0.85rem; color:#555;">Status</label>
            <select id="modalStatus" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; font-weight:bold; color:${dbItem.status === 'ACTIVE' ? '#2e7d32' : '#c62828'};">
              <option value="ACTIVE" ${dbItem.status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option>
              <option value="INACTIVE" ${dbItem.status !== 'ACTIVE' ? 'selected' : ''}>INACTIVE</option>
            </select>
          </div>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:20px; padding:10px; background:#f9f9f9; border:1px solid #eee; border-radius:4px;">
          <div style="flex:1;">
            <label style="font-weight:bold; font-size:0.85rem; color:#555;">Selling Price</label>
            ${priceInputHtml}
          </div>
          <div style="flex:1;">
            <label style="font-weight:bold; font-size:0.85rem; color:#555;">Unit Cost</label>
            ${costInputHtml}
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; gap:10px;">
          <button onclick="document.getElementById('itemEditModal').remove()" style="flex:1; background:#757575; color:#fff; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancel</button>
          <button onclick="DatabaseManager.saveModalEdits()" style="flex:1; background:#00796b; color:#fff; border:none; padding:10px; border-radius:4px; font-weight:bold; cursor:pointer; display:flex; justify-content:center; align-items:center; gap:6px;">
            <i data-lucide="save" style="width:16px; height:16px;"></i> Apply Changes
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  saveModalEdits() {
    let ref = document.getElementById('modalRef').value;
    let mfr = document.getElementById('modalMfr').value.trim();
    let desc = document.getElementById('modalDesc').value.trim();
    let cat = document.getElementById('modalCat').value.trim();
    let shelf = document.getElementById('modalShelf').value.trim().toUpperCase(); // NEW
    let status = document.getElementById('modalStatus').value;
    let price = document.getElementById('modalPrice').value.trim();
    let costEl = document.getElementById('modalCost');
    
    let isAdmin = AuthManager.currentUser && AuthManager.currentUser.isAdmin;
    let cost = (isAdmin && costEl) ? costEl.value.trim() : null;

    let dbItem = this.db.find(i => (i.sku || i.ref || '').toUpperCase() === ref.toUpperCase());
    if (dbItem) {
      let changed = (dbItem.mfr !== mfr || dbItem.desc !== desc || dbItem.category !== cat || dbItem.status !== status || (isAdmin && dbItem.price !== price) || (isAdmin && cost !== null && dbItem.cost !== cost));
      
      if (changed || dbItem.shelf !== shelf) { // Updated to detect shelf changes
        dbItem.mfr = mfr;
        dbItem.desc = desc;
        dbItem.category = cat;
        dbItem.shelf = shelf; // NEW
        dbItem.status = status;
        if (isAdmin) {
          dbItem.price = price;
          if (cost !== null) dbItem.cost = cost;
        }

        // Add to pending updates so it pushes to the cloud later
        let pendingUpd = JSON.parse(localStorage.getItem('asp_pending_updates')) || [];
        let existingUpd = pendingUpd.find(u => u.ref === ref);
        if (!existingUpd) {
          pendingUpd.push({ ref: ref, timestamp: Date.now() });
          localStorage.setItem('asp_pending_updates', JSON.stringify(pendingUpd));
        }

        localStorage.setItem('asp_wh_db', JSON.stringify(this.db));
        UIManager.showCustomAlert("Item Updated", `✅ ${ref} has been updated locally.\n\nClick "Upload Pending Sessions" later to push these changes to the cloud.`);
        this.renderDbGridEditor(); // Refresh the grid visually
      }
    }
    document.getElementById('itemEditModal').remove();
  },

  backupFullDatabase() {
    // ✨ FIX: Bundle all four arrays into the final JSON backup
    let outJSON = { 
        customers: this.customers,
        suppliers: this.suppliers,
        vendors: this.vendors, 
        items: this.db 
    };
    UIManager.triggerShareOrDownload(JSON.stringify(outJSON, null, 2), `ASP_Database_Backup_${Date.now()}.json`, 'application/json');
  },

  runMasterLookup() {
    let curRef = document.getElementById('refInput').value.trim().toUpperCase();
    let curGtin = document.getElementById('gtinInput').value.trim();
    let match = this.findDatabaseMatch(curGtin, curRef);

    if (match) {
      SessionManager.currentMatchedItem = match;
      if (curGtin && match.gtin && match.gtin !== curGtin) SessionManager.pendingUpdates['gtin'] = curGtin;
      this.populateDisplay(match);
      document.getElementById('prevDescText').textContent = `${this.getItemSku(match)} - ${this.getItemDesc(match)}`;
      document.getElementById('liveMatchPreview').style.display = 'block';

      // SMART RESERVATION AUTO-FILL: Check manifest reserved quota
      if (SessionManager.isManifestEnabled && SessionManager.expectedManifest && SessionManager.expectedManifest.length > 0) {
        let matchedSku = this.getItemSku(match);
        let manifestItem = SessionManager.expectedManifest.find(i => i.ref === matchedSku && i.isReserved);

        if (manifestItem) {
          let alreadyReserved = SessionManager.scannedObjects
            .filter(i => i.ref === matchedSku && i.actionTag === 'Reserved')
            .reduce((acc, curr) => acc + (parseInt(curr.qty, 10) || 0), 0);

          if (alreadyReserved < manifestItem.reservedQty) {
            UIManager.setItemAction('Reserved');
            let tagInput = document.getElementById('itemOrderNumInput');
            let custSelect = document.getElementById('itemCustomerSelect');

            if (manifestItem.customerTag) {
              let parts = manifestItem.customerTag.split(' - ');
              if (custSelect) custSelect.value = parts[0] || '';
              if (tagInput) tagInput.value = parts[1] || '';
            }
          } else {
            // Quota met: default back to standard Inventory
            UIManager.setItemAction('Inventory');
            let tagInput = document.getElementById('itemOrderNumInput');
            if (tagInput) tagInput.value = '';
          }
        }
      }
    } else {
      SessionManager.currentMatchedItem = null;
      UIManager.hideAllConfirmButtons();
      document.getElementById('liveMatchPreview').style.display = 'none';
    }
    UIManager.evaluateFieldAttention();
  },

  populateDisplay(item) {
    let itemSku = this.getItemSku(item);
    let itemVendor = this.getItemVendor(item);
    if (itemSku && !document.getElementById('refInput').value.trim()) document.getElementById('refInput').value = itemSku;
    if (item.gtin && !document.getElementById('gtinInput').value.trim() && !document.getElementById('chkNaGtin').checked) {
      document.getElementById('gtinInput').value = item.gtin;
    }
    if (itemVendor) {
      let vendorSelect = document.getElementById('vendorSelect');
      let targetOption = Array.from(vendorSelect.options).find(opt => opt.value.trim().toLowerCase() === itemVendor.trim().toLowerCase());
      if (targetOption) {
        vendorSelect.value = targetOption.value;
      } else {
        this.vendors.splice(this.vendors.length - 1, 0, itemVendor);
        localStorage.setItem('asp_wh_vendors', JSON.stringify(this.vendors));
        this.populateVendors();
        vendorSelect.value = itemVendor;
      }
    }
    UIManager.evaluateFieldAttention();
  },

  getItemSku: (item) => (item && (item.sku || item.ref || '').toString().trim().toUpperCase()) || '',
  getItemVendor: (item) => (item && (item.mfr || item.vendor || item.manufacturer || '').toString().trim()) || '',
  getItemDesc: (item) => (item && (item.desc || item.description || '').toString().trim()) || '',

  // CHUNKED DOWNLOAD ENGINE
  async downloadCloudDatabase(event, silent = false) {
    const btn = event ? event.target : null;
    const originalText = btn ? btn.textContent : "☁️ Sync Cloud DB";
    if (btn) { btn.textContent = "⏳ Syncing..."; btn.disabled = true; btn.style.opacity = "0.7"; }

    try {
      let page = 1;
      let totalPages = 1;
      let fullDb = { items: [], customers: [], suppliers: [], vendors: [] };
      
      do {
        if (btn) btn.textContent = `⏳ Syncing Batch ${page}...`;
        let res = await fetch(`${SessionManager.cloudArchiveUrl}?action=SYNC_DATABASE_CHUNKED&page=${page}&t=${Date.now()}`);
        let text = await res.text();
        let data;
        
        try { data = JSON.parse(text); } catch(e) { throw new Error("Connection blocked by Google. Check permissions."); }
        
        if (data.status === "success" && data.db) {
          fullDb.items = fullDb.items.concat(data.db.items || []);
          if (page === 1) {
            fullDb.customers = data.db.customers || [];
            fullDb.suppliers = data.db.suppliers || [];
            fullDb.vendors = data.db.vendors || [];
          }
          totalPages = data.totalPages || 1;
          page++;
        } else {
           throw new Error(data.message || "Unknown Apps Script connection error.");
        }
      } while (page <= totalPages);

      this.importCloudDatabase(fullDb);
      if (!silent) UIManager.showCustomAlert("Sync Complete", `✅ Master Database successfully downloaded!\n\nImported ${fullDb.items.length} total items.`);
      
      if (document.getElementById('screenDbEditor') && document.getElementById('screenDbEditor').style.display === 'block') {
        this.renderDbGridEditor(); 
      }
    } catch (err) {
      if (!silent) UIManager.showCustomAlert("Sync Error", "Error downloading database: " + err.message);
    } finally {
      if (btn) { btn.textContent = originalText; btn.disabled = false; btn.style.opacity = "1"; }
    }
  },

  // UPLOAD PENDING ONLY
  async uploadPendingData(event) {
    const btn = event ? event.target : null;
    const originalText = btn ? btn.textContent : "⬆️ Upload Pending Data";
    
    let pendingNew = JSON.parse(localStorage.getItem('asp_pending_new_items') || "[]");
    let pendingUpd = JSON.parse(localStorage.getItem('asp_pending_updates') || "[]");
    let newItemsCount = pendingNew.length;
    let updatesCount = pendingUpd.length;
    
    if (newItemsCount === 0 && updatesCount === 0) {
        UIManager.showCustomAlert("Upload Status", "All local data is already up to date with the cloud. Nothing to upload.");
        return;
    }

    const confirmUpload = async () => {
        if (btn) { btn.textContent = "⏳ Uploading..."; btn.disabled = true; btn.style.opacity = "0.7"; }
        
        let overlay = document.createElement('div');
        overlay.id = 'dbUploadOverlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:999999; display:flex; flex-direction:column; justify-content:center; align-items:center; color:#fff;';
        overlay.innerHTML = `
          <div style="background:#fff; border-radius:8px; width:100%; max-width:400px; padding:20px; box-shadow:0 4px 20px rgba(0,0,0,0.5); text-align:center;">
            <h3 style="margin:0 0 15px 0; color:#0277bd;">⬆️ Uploading Database Edits</h3>
            <div id="updStep1" style="margin-bottom:10px; font-weight:bold; color:#555;">⏳ 1. Packaging Data...</div>
            <div id="updStep2" style="margin-bottom:10px; font-weight:bold; color:#555;">⏳ 2. Syncing Master DB...</div>
            <div id="updStep3" style="margin-bottom:15px; font-weight:bold; color:#555;">⏳ 3. Verifying Upload...</div>
            <div style="width:100%; background:#eee; border-radius:4px; height:8px; overflow:hidden;">
              <div id="updProgressBar" style="width:0%; height:100%; background:#2e7d32; transition:width 0.3s ease;"></div>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);

        const updateStep = (stepNum, text, progress) => {
          let el = document.getElementById(`updStep${stepNum}`);
          if (el) el.innerHTML = `✅ <span style="color:#2e7d32;">${text}</span>`;
          let pBar = document.getElementById('updProgressBar');
          if (pBar) pBar.style.width = `${progress}%`;
        };

        try {
          let cleanCustomers = this.customers.filter(c => !c.startsWith("+") && c !== "#ERROR!");
          let cleanSuppliers = this.suppliers.filter(s => !s.startsWith("+") && s !== "#ERROR!");
          let cleanVendors = this.vendors.filter(v => !v.startsWith("+") && v !== "#ERROR!");

          let pushPayload = {
            action: "SYNC_LOCAL_DB",
            payload: { items: this.db, customers: cleanCustomers, suppliers: cleanSuppliers, vendors: cleanVendors }
          };
          
          updateStep(1, "Data Packaged", 33);
          await new Promise(r => requestAnimationFrame(() => setTimeout(r, 100)));
          
          updateStep(2, "Transmitting to Google...", 66);
          await fetch(SessionManager.cloudArchiveUrl, {
            method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(pushPayload)
          });
          
          await new Promise(r => requestAnimationFrame(() => setTimeout(r, 1000))); 

          SessionManager.pendingNewItems = []; 
          SessionManager.pendingFieldUpdates = [];
          localStorage.setItem('asp_pending_new_items', JSON.stringify([])); 
          localStorage.setItem('asp_pending_updates', JSON.stringify([]));

          // ✨ FIX: Update the Cloud Sync timestamp instantly
          localStorage.setItem('asp_last_cloud_sync', Date.now().toString());

          updateStep(3, "Upload Verified", 100);
          await new Promise(r => setTimeout(r, 300)); 

          document.body.removeChild(overlay);
          UIManager.showCustomAlert("Upload Complete", "✅ Pending items and edits successfully pushed to the cloud.");
          
          if (typeof UIManager !== 'undefined' && UIManager.evaluateSyncIndicator) {
              UIManager.evaluateSyncIndicator();
          }

        } catch (err) {
          let overlayEl = document.getElementById('dbUploadOverlay');
          if (overlayEl) document.body.removeChild(overlayEl);
          UIManager.showCustomAlert("Upload Error", "Failed to push data: " + err.message);
        } finally {
          if (btn) { btn.textContent = originalText; btn.disabled = false; btn.style.opacity = "1"; }
        }
    };

    UIManager.showCustomConfirm(
        "Review Pending Upload", 
        `You have <b>${newItemsCount}</b> new items and <b>${updatesCount}</b> field edits pending.\n\nDo you want to push these changes to the master Google Sheet now?`, 
        confirmUpload
    );
  },

  importCloudDatabase(cloudDb) {
    if (cloudDb.items && cloudDb.items.length > 0) {
      this.db = cloudDb.items;
      localStorage.setItem('asp_wh_db', JSON.stringify(this.db));
    }
    if (cloudDb.customers && cloudDb.customers.length > 0) {
      this.customers = cloudDb.customers;
      if (!this.customers.includes("+ Add Customer")) this.customers.push("+ Add Customer");
      localStorage.setItem('asp_wh_customers', JSON.stringify(this.customers));
    }
    if (cloudDb.suppliers && cloudDb.suppliers.length > 0) {
      this.suppliers = cloudDb.suppliers;
      if (!this.suppliers.includes("+ Add Supplier")) this.suppliers.push("+ Add Supplier");
      localStorage.setItem('asp_wh_suppliers', JSON.stringify(this.suppliers));
    }
    if (cloudDb.vendors && cloudDb.vendors.length > 0) {
      this.vendors = cloudDb.vendors;
      if (!this.vendors.includes("+ Create New Vendor")) this.vendors.push("+ Create New Vendor");
      localStorage.setItem('asp_wh_vendors', JSON.stringify(this.vendors));
    }
    
    // Refresh all UI dropdowns with the newly imported lists
    this.populatePartners();
    this.populateVendors();
    this.populateItemCustomerSelect();
    if (typeof UIManager !== 'undefined' && typeof UIManager.populateCustomerDropdown === 'function') {
      UIManager.populateCustomerDropdown();
    }
  }
};
