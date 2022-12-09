/**
 * Line up behavior of base GM.* functions in different userscript managers.
 * Tampermonkey 4.11.6114
 * Greasemonkey 4.9
 * Violentmonkey 2.12.7
 * Firemonkey 1.36
 * 15.06.2020
 */

/*
    Also check:
    Tampermonkey beta
    MeddleMonkey
    Moraviamonkey
    Ace Script
    Scripter
    Script Runner Pro
    Chrome User Script Handler
    User JavaScript and CSS
    JavaScript Tricks
    BetterScripter

    usi (User|Unified Script Injector)
    User script
    4chan X
    Scriptish
 */
"use strict";

let { fetch } = window; // eslint-disable-line no-unused-vars

(() => { // eslint-disable-line padded-blocks, sonarjs/cognitive-complexity

const {
    scriptHandler, // Tampermonkey, Greasemonkey, Violentmonkey, FireMonkey
    scriptMetaStr,
} = GM.info;

const [
    isTampermonkey, isGreasemonkey, isViolentmonkey, isFireMonkey,
] = [
    "Tampermonkey", "Greasemonkey", "Violentmonkey", "FireMonkey",
].map((name) => name === scriptHandler);

if (isTampermonkey) return;

const grantRE = /@grant\s+(\S+)/ig;
const grantFuncs = [];
if (isFireMonkey) {
    grantFuncs.push(
        "GM.getResourceText",
        "GM.getResourceURL",
        "GM.xmlHttpRequest",
        "GM.getValue",
        "GM.setValue",
        "GM.addStyle",
        "GM.registerMenuCommand",
    );
}
let match;
// eslint-disable-next-line no-cond-assign
while (match = grantRE.exec(scriptMetaStr)) grantFuncs.push(match[1]);
grantFuncs.forEach((funcName) => {
    const granted = funcName.startsWith("GM_") ? !!this[funcName] : !!GM[funcName.slice(3)];
    switch (funcName) {
        // Fix behavior
        case "GM.xmlHttpRequest": {
            const origXHR = GM.xmlHttpRequest;
            GM.xmlHttpRequest = (details) => new Promise((resolve, reject) => origXHR({
                ...details,
                // eslint-disable-next-line no-unused-expressions
                onload: (resp) => { resolve(resp); details.onload?.(resp); },
                // eslint-disable-next-line no-unused-expressions
                onerror: (resp) => { reject(resp); details.onerror?.(resp); },
            }));
            break;
        }
        case "GM.getResourceURL": // Violetmonkey and FireMonkey naming "feature"
            if (isViolentmonkey) {
                GM.getResourceUrl = GM.getResourceURL;
            } else if (isFireMonkey) {
                GM.getResourceUrl = (name) => GM
                    .xmlHttpRequest({ url: GM.getResourceURL(name), responseType: "blob" })
                    .then(({ response }) => window.URL.createObjectURL(response));
            }
            // fallthrough
        case "GM.getResourceUrl": // GM, TM, VM
            GM.origGetResourceUrl = GM.getResourceUrl;
            GM.getResourceUrl = (name) => GM.origGetResourceUrl(name)
                .then((blobUrl) => window.fetch(blobUrl))
                .then((resp) => resp.blob())
                .then((blob) => new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.addEventListener("load", () => resolve(reader.result));
                    reader.readAsDataURL(blob);
                }));
            break;
        // Add if needed
        case "GM.getResourceText":
            if (granted && scriptHandler !== "FireMonkey") break;
            if (["GM.getResourceUrl", "GM.getResourceURL"]
                .every((name) => !grantFuncs.includes(name))
            ) {
                console.error("GM.getResourceText requres GM.getResourceUrl/getResourceURL");
                break;
            }
            GM.getResourceText = (name) => GM.origGetResourceUrl(name)
                .then((blobUrl) => window.fetch(blobUrl))
                .then((resp) => resp.text());
            break;
        case "GM.addStyle":
            if (granted) break;
            GM.addStyle = (css) => {
                if (document.head) {
                    const elem = document.createElement("style");
                    elem.setAttribute("type", "text/css");
                    elem.textContent = css;
                    document.head.append(elem);
                    return elem;
                }
                return null;
            };
            break;
        case "GM.registerMenuCommand":
            if (granted) break;
            GM.registerMenuCommand = (caption, commandFunc, accessKey) => {
                // As the <menu> with type="contextmenu" supported only by FF (at 13.06.2020)
                // and more over it's deprecated, I (7nik) don't see a reason
                // to use the gm4-poyfill's implementation. Also, I think that replacing
                // standard context menu with custom is bad idea.
                // So I prefer to leave it blank.
            };
            break;
        case "GM_unregisterMenuCommand":
            if (granted) break;
            GM.unregisterMenuCommand = (menuCmdId) => {};
            break;
        // Unimplemented TM only functions:
        // GM_addValueChangeListener
        // GM_removeValueChangeListener
        // GM_download
        // GM_getTab
        // GM_saveTab
        // GM_getTabs
        default: if (!granted) console.error(`${funcName} not implemented!`);
    }
});

// Fix fetch only for Greasemonkey and FireMonkey
if (!isGreasemonkey && isFireMonkey) return;

// Queries are send from non-site-page context and some sites,
// e.g. api.fanbox.cc, detect it and deny quries. To overcame it,
// replace fetch with fake one which proxy data to a fetch in
// the site page context. Also, there is no way to use CustomEvent
// because data moves between context and thus violates
// "same-origin policy"  ┐( ´ д ` )┌

// Code for execution in the site page context
const waitingFetches = { lastId: 0 };
const script = document.createElement("script");
// CSP can block inline scripts, e.g. on Twitter, so pass code via a link
script.src = "data:text/javascript;base64,".concat(btoa(`
    window.addEventListener("message", ({ data: req }) => {
        if (req?.type !== "fetchRequest") return;
        fetch(req.url, req.options)
            .then((resp) => resp.arrayBuffer().then((buffer) => window.postMessage({
                ok: true,
                buffer,
                status: resp.status,
                statusText: resp.statusText,
                queryId: req.queryId,
                type: "fetchResponse",
            })))
            .catch((ex) => window.postMessage({
                ok: false,
                error: ex.message,
                queryId: req.queryId,
                type: "fetchResponse",
            }));
    });
`));
document.head.append(script);
// Replace `fetch` in this context only when and if the script ready
script.addEventListener("afterscriptexecute", (ev) => {
    fetch = (url, options) => {
        waitingFetches.lastId += 1;
        const queryId = waitingFetches.lastId;
        window.postMessage({
            url,
            options,
            queryId,
            type: "fetchRequest",
        });
        return new Promise((resolve, reject) => { waitingFetches[queryId] = { resolve, reject }; });
    };
}, { once: true });
script.addEventListener("error", console.error);
// Pass the fetch response
window.addEventListener("message", ({ data: resp }) => {
    if (resp?.type !== "fetchResponse") return;
    if (resp.ok) {
        waitingFetches[resp.queryId].resolve(new Response(resp.buffer, {
            status: resp.status, statusText: resp.statusText,
        }));
    } else {
        waitingFetches[resp.queryId].reject(new Error(resp.error));
    }
    delete waitingFetches[resp.queryId];
});

})(); // eslint-disable-line padded-blocks
