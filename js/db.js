/* ============================================================
   本地存储层
   主用 IndexedDB（可存大图、无容量上限），
   若 IndexedDB 不可用则自动降级到 localStorage。
   图片统一以「压缩后的 dataURL 字符串」保存，方便导出/导入。
   ============================================================ */

(function (global) {
  'use strict';

  var DB_NAME = 'chuchu-cuoti';
  var DB_VERSION = 1;
  var STORE = 'questions';
  var LS_KEY = 'chuchu-cuoti:questions';

  var idb = null;      // IndexedDB 实例
  var mode = 'idb';    // 'idb' | 'localStorage'

  /* ---------- IndexedDB 底层 ---------- */
  function openIDB() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('no-indexeddb')); return; }
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function (e) { idb = e.target.result; resolve(idb); };
      req.onerror = function (e) { reject(e.target.error || new Error('idb-open-error')); };
      req.onblocked = function () { reject(new Error('idb-blocked')); };
    });
  }

  function idbGetAll() {
    return new Promise(function (resolve, reject) {
      var tx = idb.transaction(STORE, 'readonly');
      var req = tx.objectStore(STORE).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function idbPut(item) {
    return new Promise(function (resolve, reject) {
      var tx = idb.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(item);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (e) { reject(e.target.error); };
      tx.onabort = function (e) { reject(e.target.error); };
    });
  }

  function idbDelete(id) {
    return new Promise(function (resolve, reject) {
      var tx = idb.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  }

  function idbClear() {
    return new Promise(function (resolve, reject) {
      var tx = idb.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  }

  function idbPutMany(items) {
    return new Promise(function (resolve, reject) {
      var tx = idb.transaction(STORE, 'readwrite');
      var store = tx.objectStore(STORE);
      items.forEach(function (it) { store.put(it); });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  }

  /* ---------- localStorage 兜底 ---------- */
  function lsRead() {
    try { return JSON.parse(global.localStorage.getItem(LS_KEY) || '[]') || []; }
    catch (e) { return []; }
  }
  function lsWrite(list) {
    global.localStorage.setItem(LS_KEY, JSON.stringify(list));
  }

  /* ---------- 统一接口 ---------- */
  var Store = {
    mode: function () { return mode; },

    init: function () {
      return openIDB().then(function () {
        mode = 'idb';
      }).catch(function () {
        mode = 'localStorage';
      });
    },

    getAll: function () {
      if (mode === 'idb') {
        return idbGetAll().catch(function () { return lsRead(); });
      }
      return Promise.resolve(lsRead());
    },

    put: function (item) {
      if (mode === 'idb') {
        return idbPut(item).catch(function () {
          var list = lsRead();
          var idx = list.findIndex(function (x) { return x.id === item.id; });
          if (idx >= 0) { list[idx] = item; } else { list.push(item); }
          lsWrite(list);
        });
      }
      var list = lsRead();
      var i = list.findIndex(function (x) { return x.id === item.id; });
      if (i >= 0) { list[i] = item; } else { list.push(item); }
      lsWrite(list);
      return Promise.resolve();
    },

    putMany: function (items) {
      if (mode === 'idb') {
        return idbPutMany(items).catch(function () {
          var list = lsRead();
          items.forEach(function (item) {
            var i = list.findIndex(function (x) { return x.id === item.id; });
            if (i >= 0) { list[i] = item; } else { list.push(item); }
          });
          lsWrite(list);
        });
      }
      var list = lsRead();
      items.forEach(function (item) {
        var i = list.findIndex(function (x) { return x.id === item.id; });
        if (i >= 0) { list[i] = item; } else { list.push(item); }
      });
      lsWrite(list);
      return Promise.resolve();
    },

    remove: function (id) {
      if (mode === 'idb') {
        return idbDelete(id).catch(function () {
          var list = lsRead().filter(function (x) { return x.id !== id; });
          lsWrite(list);
        });
      }
      var list = lsRead().filter(function (x) { return x.id !== id; });
      lsWrite(list);
      return Promise.resolve();
    },

    clear: function () {
      if (mode === 'idb') {
        return idbClear().catch(function () {
          global.localStorage.removeItem(LS_KEY);
        });
      }
      global.localStorage.removeItem(LS_KEY);
      return Promise.resolve();
    }
  };

  global.Store = Store;
})(window);
