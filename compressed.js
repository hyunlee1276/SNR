async function observeQueue(t) {
    try {
        let e = initializeWebSocket();
        e.onopen = () => subscribeToGameFlow(e);
        e.onmessage = t;
        e.onerror = t => console.error("WebSocket Error:", t);
    } catch (a) {
        console.error("Error observing game queue:", a);
    }
}

function initializeWebSocket() {
    let t = getWebSocketURI();
    return new WebSocket(t, "wamp");
}

function getWebSocketURI() {
    let t = document.querySelector('link[rel="riot:plugins:websocket"]');
    if (!t) throw Error("WebSocket link element not found");
    return t.href;
}

function subscribeToGameFlow(t) {
    let e = "/lol-gameflow/v1/gameflow-phase".replaceAll("/", "_");
    t.send(JSON.stringify([5, "OnJsonApiEvent" + e]));
}

const delay = t => new Promise(e => setTimeout(e, t));

function romanToNumber(t) {
    let e = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }, a = 0, n = 0;
    for (let i = t.length - 1; i >= 0; i--) {
        let r = e[t[i]];
        a += r < n ? -r : r;
        n = r;
    }
    return a;
}

function sumArrayElements(t) {
    return Array.isArray(t) ? t.reduce((t, e) => t + e, 0) : (console.error("Expected an array, received:", t), 0);
}

// ====================== RETRY HELPER ======================
async function retry(fn, attempts = 4, delayMs = 1200) {
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            if (i === attempts - 1) throw e;
            await delay(delayMs);
        }
    }
}

// ====================== POPUP ======================
function createPopup() {
    let t = `<div id="infoSidebar" style="z-index: 9999; position: fixed; top: 0; left: 0; width: 282px; height: 100%; background-color: #1e2328; padding: 20px; border-right: 1px solid #C8A660; box-shadow: -2px 0 5px rgba(0, 0, 0, 0.2); color: white; display: none; overflow-y: auto; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
                <div id="sidebarContent">Loading...</div>
             </div>
             <button id="toggleButton" style="position: fixed; top: 625px; left: 325px; color: #cdbe91; font-size: 14px; font-weight: bold; padding: 5px 1.3em; cursor: pointer; background: #1e2328; border: 1px solid #C8A660;">Summoner Name Reveal V2</button>`;

    document.body.insertAdjacentHTML("beforeend", t);
    document.getElementById("toggleButton").addEventListener("click", toggleSidebar);
}

// ====================== CORE LOGIC ======================
async function handleChampionSelect() {
    try {
        let config = { textchat: true, popup: true };
        try {
            let e = getScriptPath()?.match(/\/([^/]+)\/index\.js$/)?.[1];
            let a = await fetch(`https://plugins/${decodeURI(e)}/config.json`);
            config = await a.json();
        } catch {}

        if (config.popup) createPopup();

        await delay(1200); // Short initial wait

        const regionData = await create("GET", "/riotclient/region-locale");
        const webRegion = regionData.webRegion;

        // === Try modern champ select session first ===
        let players = [];
        try {
            players = await retry(async () => {
                const session = await create("GET", "/lol-champ-select/v1/session");
                if (session?.myTeam?.length) return session.myTeam;
                if (session?.enemyTeam?.length) return [...session.myTeam, ...session.enemyTeam];
                throw new Error("No team data");
            });
        } catch (e) {
            console.warn("Champ select session not ready, falling back to chat...");
        }

        // === Fallback to chat participants ===
        if (!players || players.length === 0) {
            players = await retry(async () => {
                const o = await create("GET", "//riotclient/chat/v5/participants");
                const filtered = o?.participants?.filter(t => t.cid?.includes("champ-select")) || [];
                if (filtered.length === 0) throw new Error("No players in chat");
                return filtered;
            });
        }

        if (!players || players.length === 0) {
            console.error("Could not find any players");
            return;
        }

        const puuids = players.map(p => p.puuid).filter(Boolean);

        // Fetch data (reduced to 10 games)
        const matchPromises = puuids.map(puuid => queryMatch(puuid, 0, 10));
        const rankedPromises = puuids.map(fetchRankedStats);

        const [matchDataArrays, rankedData] = await Promise.all([
            Promise.all(matchPromises),
            Promise.all(rankedPromises)
        ]);

        const formattedPopup = players.map((t, e) => formatPlayerData2(t, extractSimplifiedStats(rankedData[e]), matchDataArrays[e]));
        const formattedChat = players.map((t, e) => formatPlayerData(t, extractSimplifiedStats(rankedData[e]), matchDataArrays[e]));

        // Chat messages
        if (config.textchat) {
            const chatInfo = await getChampionSelectChatInfo();
            if (chatInfo) {
                for (let msg of formattedChat) {
                    await postMessageToChat(chatInfo.id, msg);
                }
            }
        }

        // Links
        const f = players.map(t => encodeURIComponent(`${t.game_name}#${t.game_tag}`)).join("%2C");
        const y = players.map(t => encodeURIComponent(`${t.game_name}#${t.game_tag}`)).join(",");
        const b = `https://www.op.gg/multisearch/${webRegion}?summoners=${f}`;
        const w = `https://porofessor.gg/pregame/${webRegion}/${y}`;

        const links = `<p style="font-size: 12px"><a href="${b}" target="_blank" style="color: gold;">View on OP.GG</a><br><a href="${w}" target="_blank" style="color: gold;">View on Porofessor.gg</a></p>`;

        if (config.popup) {
            populateContent(formattedPopup, links);
        }

    } catch (err) {
        console.error("Error in Champion Select phase:", err);
    }
}

// Keep your existing helper functions (only minor changes below)
function populateContent(t, e) {
    let n = `<p style="font-size: 12px">${t.join("<br>")}</p>`;
    document.getElementById("sidebarContent").innerHTML = n + e + `<p style="font-size: 10px">This is a beta overlay...<br>Config: <a href="https://github.com/dakota1337x/Summoner-Name-Reveal-V2" target="_blank" style="color: gold;">GitHub</a></p>`;
}

async function queryMatch(t, e = 0, a = 10) {  // Reduced default to 10
    try {
        let n = `/lol-match-history/v1/products/lol/${t}/matches?begIndex=${e}&endIndex=${a}`;
        let i = await create("GET", n);
        return i?.games?.games || [];
    } catch (o) {
        console.error("Error querying match for puuid:", t, o);
        return [];
    }
}

// ... (keep all your other functions unchanged: extractMatchData, getMatchDataForPuuids, fetchRankedStats, etc.)

function formatPlayerData(t, e, a) {
    let n = calculateWinRate(a.winList),
        i = mostCommonRole(a.laneList),
        r = calculateKDA(a.killList, a.assistsList, a.deathsList);
    return `${t.game_name} - ${e} - ${n} - ${i} - ${r}`;
}

function formatPlayerData2(t, e, a) {
    let n = calculateWinRate(a.winList),
        i = mostCommonRole(a.laneList),
        r = calculateKDA(a.killList, a.assistsList, a.deathsList);
    return `${t.game_name}#${t.game_tag} - ${e} - ${n} - ${i} - ${r}`;
}

// Keep updateLobbyState, calculateWinRate, mostCommonRole, calculateKDA, etc. unchanged
function updateLobbyState(t) {
    try {
        let e = JSON.parse(t.data);
        "ChampSelect" === e[2].data ? handleChampionSelect() : removeSidebar();
    } catch (a) {
        console.error("Error updating lobby state:", a);
    }
}

window.toggleSidebar = function () {
    let t = document.getElementById("infoSidebar");
    if (t) t.style.display = t.style.display === "none" ? "block" : "none";
};

const API_HEADERS = { accept: "application/json", "content-type": "application/json" };

async function create(t, e, a) {
    let n = { method: t, headers: API_HEADERS, ...a ? { body: JSON.stringify(a) } : {} };
    try {
        let i = await fetch(e, n);
        if (!i.ok) throw Error(`HTTP error! status: ${i.status}`);
        return await i.json();
    } catch (r) {
        console.error(`Error in create function for ${t} ${e}:`, r);
        return null;
    }
}

async function initializeApp() {
    try {
        await observeQueue(updateLobbyState);
    } catch (t) {
        console.error("Error initializing application:", t);
    }
}

window.addEventListener("load", initializeApp);
