/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var simplels = (function() {

    // Our global simplels container is defined via a closure to get
    // privately these shorthands for Components, not available in SeaMonkey,
    // and to prevent re-declarating them in other cases.
    const Cc = Components.classes;
    const Ci = Components.interfaces;
    const Cu = Components.utils;


    return {

    langsvc: null,
    windowLocale: null,

    prefs: null,
    strings: null,
    localeStrings: {languageNames: null, regionNames: null, formats: null},

    isToolbarButtonUpdatePending: false,


    handleEvent: function(event) {
        switch (event.type) {
            case "load":
                window.removeEventListener("load", simplels);
                this.onLoad();
                break;

            case "aftercustomization":
                this.checkIfUpdatingToolbarButton();
                break;

            case "unload":
                this.onUnload();
                break;
        }
    },


    onLoad: function() {
        Cu.import("chrome://simplels/content/modules/general.jsm", this);
        Cu.import("chrome://simplels/content/modules/language.jsm", this);

        this.langsvc = Cc["@nohamelin/sls/language-service;1"]
                       .getService().wrappedJSObject;
        this.windowLocale = this.langsvc.currentLocale;

        this.prefs = Services.prefs.getBranch("extensions.simplels.");
        this.strings = this.getStringBundle("simplels-strings");
        this.localeStrings.languageNames = this.getStringBundle(
                                                "simplels-language-names");
        this.localeStrings.regionNames = this.getStringBundle(
                                                "simplels-region-names");
        this.localeStrings.formats = this.getStringBundle(
                                                "simplels-name-formats");

        this.prefs.addObserver("", this, false);

        Services.obs.addObserver(this, "sls:selected-changed", false);
        Services.obs.addObserver(this, "sls:availables-changed", false);

        // Initialize dinamic attributes of commands and toolbar button
        this.updateRestartCommand();
        this.updateMatchCommand();
        this.updateDescriptionsBroadcaster();
        this.updateCustomProviderBroadcaster();

        window.setTimeout(function() {
            simplels.tryToUpdateToolbarButton();
        }, 60);

        window.addEventListener("aftercustomization", simplels);
    },


    onUnload: function() {
        this.prefs.removeObserver("", this);

        Services.obs.removeObserver(this, "sls:selected-changed");
        Services.obs.removeObserver(this, "sls:availables-changed");
    },


    updateRestartCommand: function() {
        let restartCmd = document.getElementById(
                                  "sls_toggleRestartAfterSwitch");
        let wantRestart = this.prefs.getBoolPref("button.restartAfterSwitch");

        restartCmd.setAttribute("checked", wantRestart);
    },


    updateMatchCommand: function() {
        let matchCmd = document.getElementById("sls_enableMatchingOS");
        let wantMatch = this.langsvc.matchingOS;
        let disableMatch = this.langsvc.isMatchingOSLocked;

        matchCmd.setAttribute("checked", wantMatch);
        if (disableMatch)
            matchCmd.setAttribute("disabled", "true");
        else
            matchCmd.removeAttribute("disabled");
    },


    updateDescriptionsBroadcaster: function() {
        let descBcstr = document.getElementById("sls_showLocaleDescriptions");
        let wantDescriptions = this.prefs.getBoolPref(
                                         "button.showDescriptions");

        descBcstr.setAttribute("descriptions", wantDescriptions);
    },


    updateCustomProviderBroadcaster: function() {
        let customBcstr = document.getElementById(
                                   "sls_customLanguagesProvider");
        let resetCmd = document.getElementById("sls_resetLanguagesProvider");
        let customProvider = !this.langsvc.isSelectedProviderDefault;

        customBcstr.setAttribute("hidden", !customProvider);

        if (customProvider)
            resetCmd.removeAttribute("disabled");
        else
            resetCmd.setAttribute("disabled", "true");
    },


    checkIfUpdatingToolbarButton: function() {
        if (this.isToolbarButtonUpdatePending) {
            this.tryToUpdateToolbarButton();
        }
    },


    tryToUpdateToolbarButton: function() {
        let foundButton = document.getElementById("simplels-button");
        if (foundButton) {
            this.isToolbarButtonUpdatePending = false;

            this.updateToolbarButtonTooltip();
            this.populatePopupLocales();

            // The general items of the toolbar button's popup work with
            // broadcasters, so they are always correctly set, and we can
            // to ignore them here.
        } else {
            this.isToolbarButtonUpdatePending = true;
        }
    },


    updateToolbarButtonTooltip: function() {
        let $ = function(id) {
            return document.getElementById("simplels-button-tooltip-" + id);
        };

        // The tooltip displays information about the next pieces:
        //
        // 1. The locale selected, expected by the user.
        let selectedLocale = this.langsvc.selectedLocale;
        let isSelectedMatchingOS = this.langsvc.matchingOS;
        let isSelectedAvailable = this.langUtils
                                      .isLocaleAvailable(selectedLocale);
        let informAboutSelected = isSelectedMatchingOS || !isSelectedAvailable;

        $("selected").value = this.getLocaleName(selectedLocale);
        $("selected-about").hidden = !informAboutSelected;

        let aboutMsg = "";
        if (informAboutSelected) {
            let matchingMsg = this.strings.getString("tooltip.matchingOS");
            let noAvailableMsg = this.strings.getString("tooltip.noAvailable");

            if (isSelectedMatchingOS && !isSelectedAvailable) {
                aboutMsg = this.strings.getFormattedString("tooltip.both",
                                                           [matchingMsg,
                                                            noAvailableMsg]);
            } else if (isSelectedMatchingOS) {
                aboutMsg = matchingMsg;
            } else {    // !isSelectedAvailable
                aboutMsg = noAvailableMsg;
            }
        }
        $("selected-about").value = aboutMsg;

        // 2. The locale applied to the current window.
        //    It's hidden if its value matches the currently selected locale.
        let areLocalesInConflict = (this.windowLocale !== selectedLocale);

        $("current-row").hidden = !areLocalesInConflict;
        $("current").value = this.getLocaleName(this.windowLocale);

        document.getElementById("simplels-button-tooltip")
                .setAttribute("conflicting", areLocalesInConflict);

        // 3. The locale provider selected.
        //    It's hidden (by a broadcaster) if the default provider is used.
        let selectedProvider = this.langsvc.selectedProvider;
        let selectedProviderName = this.localeStrings
                                       .formats
                                       .getFormattedString("unnamed",
                                                           [selectedProvider]);
        $("provider").value = selectedProviderName;
    },


    populatePopupLocales: function() {
        Cu.import("chrome://simplels/content/modules/dom.jsm", this);

        let localeItemCallback = function(locale) {
            return function() { simplels.switchTo(locale); };
        };
        let checkedLocale = this.langsvc.userLocale;
        let isCheckedAvailable = this.langUtils
                                     .isLocaleAvailable(checkedLocale);
        let isCheckedIgnored = this.langsvc.matchingOS;
        let isCheckedLocked = this.langsvc.isUserLocaleLocked;
        let isCurrentAvailable = this.langUtils
                                     .isLocaleAvailable(this.windowLocale);

        let locales = this.getWindowRelevantLocales();
        this.langUtils.sortLocales(locales);

        let popup = document.getElementById("simplels-button-popup");
        this.domUtils.removeChildrenByClassName(popup, "simplels-locale");

        let popupFragment = document.createDocumentFragment();
        locales.forEach(function(locale) {
            let item = document.createElement("menuitem");

            item.className = "simplels-locale";
            item.setAttribute("type", "radio");
            item.setAttribute("autocheck", "false");
            item.setAttribute("locale", locale);
            item.setAttribute("label", this.getLocaleName(locale));
            item.setAttribute("description", locale);
            item.addEventListener("command", localeItemCallback(locale));

            if (locale === this.windowLocale) {
                item.setAttribute("current", "true");
                if (!isCurrentAvailable)
                    item.setAttribute("disabled", "true");
            }
            if (locale === checkedLocale) {
                if (!isCheckedIgnored)
                    item.setAttribute("checked", "true");
                if (!isCheckedAvailable) {
                    item.setAttribute("disabled", "true");

                    if (isCheckedIgnored && locale !== this.windowLocale)
                        item.setAttribute("hidden", "true");  // Not relevant
                }
            }
            if (isCheckedLocked) {
                item.setAttribute("disabled", "true");
            }

            popupFragment.appendChild(item);
        }, this);

        let matchNode = popup.getElementsByClassName("simplels-matching")[0];
        popup.insertBefore(popupFragment, matchNode.nextSibling);
    },


    updatePopupLocaleTooltip: function() {
        let node = document.tooltipNode;

        // The locale attribute is used here instead of the simplels-locale
        // class to include the case of an empty locale.
        if (!node.getAttribute("locale"))
            return false;

        document.getElementById("simplels-locale-tooltip-name")
                .value = node.label;
        document.getElementById("simplels-locale-tooltip-tag")
                .value = node.getAttribute("locale");

        return true;    // Show the tooltip
    },


    observe: function(subject, topic, data) {
        switch (topic) {
            case "sls:selected-changed":
                this.updateMatchCommand();
                this.tryToUpdateToolbarButton();
                break;

            case "sls:availables-changed":
                this.updateCustomProviderBroadcaster();
                this.tryToUpdateToolbarButton();
                break;

            case "nsPref:changed":
                switch (data) {
                    case "button.restartAfterSwitch":
                        this.updateRestartCommand();
                        break;

                    case "button.showDescriptions":
                        this.updateDescriptionsBroadcaster();
                        break;
                }
                break;
        }
    },


    openLanguagesManager: function() {
        switch (this.utils.application) {
            case this.SEAMONKEY_ID:
                toEM("addons://list/locale");
                break;

            case this.THUNDERBIRD_ID:
            default:
                openAddonsMgr("addons://list/locale");
                break;
        }
    },


    openGetMoreLanguagesPage: function() {
        Cu.import("chrome://simplels/content/modules/langpacks.jsm", this);
        let getURL = this.getMoreLanguagesURL();

        switch (this.utils.application) {
            case this.SEAMONKEY_ID:
                openUILink(getURL);
                break;

            case this.THUNDERBIRD_ID:
            default:
                this.tbUtils.openContentTab(getURL);
                break;
        }
    },


    toggleRestartAfterSwitch: function() {
        let wantedRestart = this.prefs.getBoolPref("button.restartAfterSwitch");

        this.prefs.setBoolPref("button.restartAfterSwitch", !wantedRestart);
    },


    enableMatchingOS: function() {
        this.langsvc.matchingOS = true;

        this.restartAfterSwitch();
    },


    switchTo: function(locale) {
        this.langsvc.userLocale = locale;

        this.restartAfterSwitch();
    },


    restartAfterSwitch: function() {
        let wantRestart = this.prefs.getBoolPref("button.restartAfterSwitch");
        if (wantRestart) {
            Cu.import("resource://gre/modules/BrowserUtils.jsm", {})
              .BrowserUtils.restartApplication();
        }
    },


    resetLanguagesProvider: function() {
        this.langsvc.resetSelectedProvider();
    },


    getWindowRelevantLocales: function() {
        let locales = this.langUtils.findRelevantLocales();

        if (locales.indexOf(this.windowLocale) === -1) { // If it isn't found:
            // TODO: The slicing could to be avoided in some cases
            locales = locales.slice();
            locales.push(this.windowLocale);
        }
        return locales;
    },


    getLocaleName: function(locale) {
        return this.langUtils.buildLocaleName(locale, this.localeStrings);
    },


    getStringBundle: function(id) {
        return this.langUtils.getStringBundle(id, document);
    }

    };
})();


window.addEventListener("load", simplels);
window.addEventListener("unload", simplels);
