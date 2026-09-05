/* =======================================================================
 * Allied Surgical Products - Inventory Management System
 * File: js/authManager.js
 * Author: Thomas Seyfors
 * Date Created: August 2026
 * 
 * Description:
 *   Security and authentication gatekeeper. Manages Google Workspace 
 *   OAuth 2.0 sign-in, session storage tokens, and Role-Based Access Control 
 *   (RBAC) for Admin functionality.
 *
 * Affected Features:
 *   - Google Account Sign-In
 *   - Guest Mode Restrictions
 *   - UI Locking & Element Visibility
 *   - Developer Tools Access
 *
 * Copyright (c) 2026 Thomas Seyfors / Allied Surgical Products.
 * All Rights Reserved.
 * ======================================================================= */
const AuthManager = {
  currentUser: null,
  isGuest: false,
  isWorkstation: false, // NEW FLAG

  idleTimeout: null,
  idleDuration: 60 * 60 * 1000, // 1 hour in milliseconds
  activityEvents: ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'],
  
  // NOTE: This is the actual Google Cloud Client ID to allow secure Google Sign-in.
  clientId: "578227168676-721gv6n3bt5qqcd67v1vhi6111c35fcc.apps.googleusercontent.com",

  // Add your authorized admin emails here
  ADMIN_EMAILS: ['jessica@alliedsurgicalproducts.com', 'thomas@alliedsurgicalproducts.com', 'asp.techops.workstation@gmail.com'],

  init() {
    let savedSession = sessionStorage.getItem('asp_auth_session');
    if (savedSession) {
      this.currentUser = JSON.parse(savedSession);
      this.isGuest = false;
      this.isWorkstation = this.currentUser.email.toLowerCase() === 'asp.techops.workstation@gmail.com';
      this.unlockApp();
    } else {
      this.showLoginScreen();
    }
  },

  showLoginScreen() {
    document.getElementById('screenSetup').style.display = 'none';
    document.getElementById('screenLogin').style.display = 'flex';
    this.renderGoogleButton();
  },

  renderGoogleButton() {
    if (window.google && window.google.accounts) {
      google.accounts.id.initialize({
        client_id: this.clientId, 
        callback: (response) => this.handleCredentialResponse(response),
        auto_select: false,
        prompt: 'select_account',
        cancel_on_tap_outside: true
      });

      google.accounts.id.renderButton(
        document.getElementById('googleAuthButton'), 
        { theme: 'outline', size: 'large', width: 350 }
      );
    }
  },

  handleCredentialResponse(response) {
    const payload = this.parseJwt(response.credential);
    
    // Domain Verification Lockdown + Workstation Override
    let isWorkstationEmail = payload.email.toLowerCase() === 'asp.techops.workstation@gmail.com';
    
    if (payload.email && (payload.email.endsWith('@alliedsurgicalproducts.com') || isWorkstationEmail)) {
      
      // RBAC Check for Price/Cost Editing
      let isAdmin = this.ADMIN_EMAILS.includes(payload.email.toLowerCase());
      
      this.currentUser = { name: payload.name, email: payload.email, verified: true, isAdmin: isAdmin };
      this.isGuest = false;
      this.isWorkstation = isWorkstationEmail;
      
      if (this.isWorkstation) {
        // ✨ NEW: Intercept the login and force the user name prompt
        this.promptWorkstationUser();
      } else {
        // Standard user flow
        sessionStorage.setItem('asp_auth_session', JSON.stringify(this.currentUser));
        this.unlockApp();
      }
    } else {
      alert("Access Denied: You must be an authorized Allied Surgical Products employee.");
    }
  },

  // ✨ NEW: Workstation Profile Gateway Functions
  promptWorkstationUser() {
    let modal = document.createElement('div');
    modal.id = 'workstationUserModal';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:999999; display:flex; justify-content:center; align-items:center; padding:15px; box-sizing:border-box;';
    
    let userList = (typeof DatabaseManager !== 'undefined' && DatabaseManager.users) ? DatabaseManager.users : ["Thomas", "Trey", "Jessica", "+ New User"];
    let optionsHtml = userList.map(u => `<option value="${u}">${u}</option>`).join('');

    modal.innerHTML = `
      <div style="background:#fff; border-radius:8px; width:100%; max-width:400px; padding:20px; box-shadow:0 4px 20px rgba(0,0,0,0.5); text-align:center;">
        <h3 style="margin:0 0 15px 0; color:#0277bd;">🏭 Workstation Login</h3>
        <p style="font-size:0.9rem; color:#555; margin-bottom:15px;">Please select your User Name to continue.</p>
        
        <select id="workstationUserSelect" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px; font-size:1rem; font-weight:bold; margin-bottom:20px; color:#0277bd;">
            ${optionsHtml}
        </select>

        <div style="display:flex; justify-content:space-between; gap:10px;">
          <button onclick="AuthManager.cancelWorkstationLogin()" style="flex:1; background:#757575; color:#fff; border:none; padding:10px; border-radius:4px; cursor:pointer;">Cancel</button>
          <button onclick="AuthManager.confirmWorkstationLogin()" style="flex:1; background:#0277bd; color:#fff; border:none; padding:10px; border-radius:4px; font-weight:bold; cursor:pointer;">Login</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Dynamic "+ New User" logic
    document.getElementById('workstationUserSelect').addEventListener('change', (e) => {
        if (e.target.value === "+ New User") {
            let newName = prompt("Enter new User Name:");
            if (newName && newName.trim()) {
                let cleanName = newName.trim();
                if (typeof DatabaseManager !== 'undefined' && DatabaseManager.users) {
                    DatabaseManager.users.splice(DatabaseManager.users.length - 1, 0, cleanName);
                    localStorage.setItem('asp_wh_users', JSON.stringify(DatabaseManager.users));
                }
                let opt = document.createElement('option');
                opt.value = cleanName; opt.textContent = cleanName;
                e.target.insertBefore(opt, e.target.lastElementChild);
                e.target.value = cleanName;
            } else {
                e.target.selectedIndex = 0;
            }
        }
    });
  },

  confirmWorkstationLogin() {
    let sel = document.getElementById('workstationUserSelect');
    let chosenName = sel ? sel.value : "";
    if (!chosenName || chosenName === "+ New User") {
        alert("Please select a valid User Name.");
        return;
    }
    
    localStorage.setItem('asp_user_name', chosenName);
    sessionStorage.setItem('asp_auth_session', JSON.stringify(this.currentUser));
    document.getElementById('workstationUserModal').remove();
    this.unlockApp(); // Continue the sequence
  },

  cancelWorkstationLogin() {
    let modal = document.getElementById('workstationUserModal');
    if (modal) modal.remove();
    this.logout(true);
  },

  continueAsGuest() {
    this.isGuest = true;
    this.currentUser = { name: "Guest Scanner", email: "", verified: false };
    this.unlockApp();
  },

  unlockApp() {
    document.getElementById('screenLogin').style.display = 'none';
    document.getElementById('screenSetup').style.display = 'block';
    
    let advLabel = document.getElementById('chkAdvancedMode') ? document.getElementById('chkAdvancedMode').parentElement : null;
    let archiveBtn = document.getElementById('btnSessionArchive');
    let lookupBtn = document.getElementById('btnItemLookup');
    let userNameInput = document.getElementById('userNameInput');
    
    let stagedFeed = document.getElementById('panelStagedFeed');
    let preloadToggle = document.getElementById('rowPreloadToggle');
    let enterpriseHub = document.getElementById('panelEnterpriseHub');
    let btnStock = document.getElementById('btnStocktake');
    let btnTrace = document.getElementById('btnTraceability');
    let roleBadge = document.getElementById('userRoleBadge');
    let rowQboSync = document.getElementById('rowQboSync');

    if (this.isGuest) {
      // LOCKDOWN MODE
      if (advLabel) advLabel.style.display = 'none';
      if (archiveBtn) archiveBtn.style.display = 'none';
      if (lookupBtn) lookupBtn.style.display = 'none';
      if (userNameInput) userNameInput.value = "";
      
      if (stagedFeed) stagedFeed.style.display = 'none';
      if (preloadToggle) preloadToggle.style.display = 'none';
      if (enterpriseHub) enterpriseHub.style.display = 'none';
      if (btnStock) btnStock.style.display = 'none';
      if (btnTrace) btnTrace.style.display = 'none';

      let rowQboSettings = document.getElementById('rowQboSettings');
      if (rowQboSettings) rowQboSettings.style.display = 'none';
      
      if (roleBadge) {
        roleBadge.textContent = "Guest Mode";
        roleBadge.style.backgroundColor = "#c62828";
      }
      
      // Force checkbox to uncheck, then trigger UI lockdown
      let chk = document.getElementById('chkAdvancedMode');
      if (chk) chk.checked = false;
      UIManager.toggleAdvancedMode(false); 
      
      // Purge business intelligence from dropdowns
      DatabaseManager.suppliers = ["+ Add Supplier"];
      DatabaseManager.customers = ["+ Add Customer"];
      DatabaseManager.populatePartners();
      DatabaseManager.populateItemCustomerSelect();
      
    } else {
      // VERIFIED MODE
      if (advLabel) advLabel.style.display = 'flex';
      if (archiveBtn) archiveBtn.style.display = 'inline-block';
      if (lookupBtn) lookupBtn.style.display = 'inline-block';
      
      let userNameSelect = document.getElementById('userNameSelect');
      
      // UI Element Targeting
      let btnStock = document.getElementById('btnStocktake');
      let btnDbEditor = document.querySelector('button[onclick="UIManager.openDbEditor()"]'); // Select by action since it lacks an ID
      let preloadToggle = document.getElementById('rowPreloadToggle');
      let feedPanel = document.getElementById('panelStagedFeed');
      let reportsInv = document.getElementById('panelInventoryReports');
      let reportsRevMed = document.getElementById('panelRevMedReports');
      let reportsCust = document.getElementById('panelCustomerReports');

      if (this.isWorkstation) {
         if (userNameInput) userNameInput.style.display = 'none';
         if (userNameSelect) {
             userNameSelect.style.display = 'block';
             let userList = (typeof DatabaseManager !== 'undefined' && DatabaseManager.users) ? DatabaseManager.users : ["Thomas", "Trey", "Jessica", "+ New User"];
             userNameSelect.innerHTML = userList.map(u => `<option value="${u}">${u}</option>`).join('');
             userNameSelect.value = localStorage.getItem('asp_user_name') || userList[0];
         }
         
         // ✨ NEW: Hide Danger Zones from Workstation
         if (btnStock) btnStock.style.display = 'none';
         if (btnDbEditor) btnDbEditor.style.display = 'none';
         if (preloadToggle) preloadToggle.style.display = 'none';
         if (feedPanel) feedPanel.style.display = 'none';
         if (reportsInv) reportsInv.style.display = 'none';
         if (reportsRevMed) reportsRevMed.style.display = 'none';
         if (reportsCust) reportsCust.style.display = 'none';

      } else {
         if (userNameInput) {
             userNameInput.style.display = 'block';
             userNameInput.value = this.currentUser.name.split(' ')[0];
         }
         if (userNameSelect) userNameSelect.style.display = 'none';
      }

      let rowQboSettings = document.getElementById('rowQboSettings');
      if (rowQboSettings) rowQboSettings.style.display = (this.currentUser.isAdmin && !this.isWorkstation) ? 'flex' : 'none';

      let devToolsContainer = document.getElementById('devToolsContainer');
      if (devToolsContainer) {
        let isDeveloper = this.currentUser.email.toLowerCase() === 'thomas@alliedsurgicalproducts.com';
        devToolsContainer.style.display = isDeveloper ? 'flex' : 'none';
      }

      // Strict Admin Check for QBO Sync
      if (rowQboSync) {
        rowQboSync.style.display = (this.currentUser.isAdmin && !this.isWorkstation) ? 'flex' : 'none';
      }

      if (roleBadge) {
        roleBadge.textContent = this.isWorkstation ? "Warehouse Workstation" : "Verified Workspace";
        roleBadge.style.backgroundColor = this.isWorkstation ? "#0277bd" : "#2e7d32";
      }
      
      // Restore standard lists
      DatabaseManager.suppliers = JSON.parse(localStorage.getItem('asp_wh_suppliers')) || ["+ Add Supplier"];
      DatabaseManager.customers = JSON.parse(localStorage.getItem('asp_wh_customers')) || ["+ Add Customer"];
      DatabaseManager.populatePartners();
      DatabaseManager.populateItemCustomerSelect();
      if (typeof UIManager.populateCustomerDropdown === 'function') UIManager.populateCustomerDropdown();    

      // === AUTO-SYNC LOGIC (First Login Only) ===
      if (!sessionStorage.getItem('asp_has_auto_synced')) {
         sessionStorage.setItem('asp_has_auto_synced', 'true');
         setTimeout(() => {
            if (typeof window.masterSystemSync === 'function') {
                window.masterSystemSync(null);
            }
         }, 500);
      }
      // ----------------------------------------
    }

    // Start tracking inactivity on successful authentication
    this.startIdleTimer();
  },

  /**
   * Initializes the idle auto-logout timer and attaches event listeners.
   */
  startIdleTimer() {
    this.stopIdleTimer(); // Clear any existing timer/listeners

    // Bind handler so 'this' consistently refers to authManager
    this.handleUserActivity = this.resetIdleTimer.bind(this);

    // Attach listeners with passive flag for performance
    this.activityEvents.forEach((event) => {
      window.addEventListener(event, this.handleUserActivity, { passive: true });
    });

    // Start the initial countdown
    this.resetIdleTimer();
  },

  /**
   * Resets the inactivity timer whenever user action is detected.
   */
  resetIdleTimer() {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
    }

    this.idleTimeout = setTimeout(() => {
      this.handleIdleTimeout();
    }, this.idleDuration);
  },

  /**
   * Removes event listeners and clears the active timer.
   */
  stopIdleTimer() {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }

    if (this.handleUserActivity) {
      this.activityEvents.forEach((event) => {
        window.removeEventListener(event, this.handleUserActivity);
      });
      this.handleUserActivity = null;
    }
  },

  /**
   * Triggered when 60 minutes of inactivity elapse.
   */
  handleIdleTimeout() {
    this.stopIdleTimer();
    console.warn('Session expired due to 1 hour of inactivity.');
    alert('You have been logged out due to inactivity.');
    
    // Pass 'true' to force the logout without asking for confirmation
    this.logout(true); 
  },

  logout(force = false) {
    // Only ask for confirmation if this is a manual logout
    if (!force && !confirm("Are you sure you want to log out?")) return;
    
    // Stop the timer and remove listeners only after we know we are logging out
    this.stopIdleTimer();
    
    this.currentUser = null;
    this.isGuest = false;
    
    // Clear Authentication Tokens
    localStorage.removeItem('asp_auth_session');
    sessionStorage.removeItem('asp_auth_session');
    
    // ✨ FIX: Wipe the Circuit Breaker token so the next user is forced to re-download the allocations!
    sessionStorage.removeItem('asp_allocations_verified');
    
    // SECURITY PATCH: Wipe sensitive warehouse data upon logout
    localStorage.removeItem('asp_allocations');
    localStorage.removeItem('asp_remote_analytics');
    
    // Reload to enforce lockdown
    window.location.reload();
  },

  parseJwt(token) {
    var base64Url = token.split('.')[1];
    var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    var jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  }
};