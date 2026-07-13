(() => {
    'use strict';

    const button = document.getElementById('restore-historical-data-btn');
    if (!button) return;

    const CACHE_KEY = 'cultWastedVotes:v6';
    const CACHE_DB_NAME = 'cultWastedVotesCache';
    const CACHE_DB_STORE = 'caches';
    const LOCAL_STORAGE_CACHE_LIMIT = 4_500_000;

    const setHint = message => {
        const hint = button.querySelector('.menu-hint');
        if (hint) hint.textContent = message;
    };
    const openCacheDb = () => new Promise((resolve, reject) => {
        const request = indexedDB.open(CACHE_DB_NAME, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(CACHE_DB_STORE)) request.result.createObjectStore(CACHE_DB_STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    });
    const writeIndexedCache = async value => {
        const db = await openCacheDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(CACHE_DB_STORE, 'readwrite');
            transaction.objectStore(CACHE_DB_STORE).put(value, CACHE_KEY);
            transaction.oncomplete = () => { db.close(); resolve(); };
            transaction.onerror = () => { db.close(); reject(transaction.error || new Error('IndexedDB write failed')); };
            transaction.onabort = () => { db.close(); reject(transaction.error || new Error('IndexedDB write aborted')); };
        });
    };

    button.addEventListener('click', async () => {
        button.disabled = true;
        setHint('Downloading a complete JSON backup first...');
        try {
            const backup = window.CultHistoricalDataUpdates?.backupAllJson;
            if (!backup) throw new Error('Safety backup is unavailable; restore stopped');
            await backup({ reason: 'governance-history-restore' });
            setHint('Restoring the bundled historical dataset...');
            const response = await fetch('historical-cult-governance-data.json', { cache: 'no-cache' });
            if (!response.ok) throw new Error(`Historical dataset request failed (${response.status})`);
            const payload = await response.json();
            const cache = payload?.cache || payload;
            if (cache?.version !== 6 || !cache?.proposals || typeof cache.proposals !== 'object') throw new Error('Historical dataset format is invalid');
            let indexedSaved = false;
            try { await writeIndexedCache(cache); indexedSaved = true; } catch { /* Local storage remains a fallback for smaller datasets. */ }
            const serialized = JSON.stringify(cache);
            if (serialized.length <= LOCAL_STORAGE_CACHE_LIMIT) localStorage.setItem(CACHE_KEY, serialized);
            else localStorage.removeItem(CACHE_KEY);
            if (!indexedSaved && serialized.length > LOCAL_STORAGE_CACHE_LIMIT) throw new Error('Browser storage is unavailable');
            window.location.reload();
        } catch (error) {
            setHint(error?.message || 'Historical data restore failed.');
            button.disabled = false;
        }
    });
})();
