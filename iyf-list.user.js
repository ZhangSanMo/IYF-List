// ==UserScript==
// @name         爱壹帆 (IYF) 获取列表
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @description  基于 V3 API 结构化解析，精准捕获集数、分辨率和真实 M3U8 地址。仅在播放页显示，支持从当前集开始遍历。
// @author       User
// @match        *://www.iyf.tv/*
// @match        *://m.iyf.tv/*
// @match        *://*.iyf.tv/*
// @run-at       document-start
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @allFrames    true
// ==/UserScript==

(function() {
    'use strict';

    let results = new Map();
    const RES_WEIGHT = { "2160": 4, "4k": 4, "1080": 3, "720": 2, "576": 1 };

    // --- 核心：解析 V3 API 返回的 JSON ---
    function parseVideoJson(json) {
        try {
            if (!json || !json.data || !json.data.info || json.data.info.length === 0) return;

            const info = json.data.info[0];
            const epName = info.mediaTitle || "未知";

            if (info.clarity && Array.from(info.clarity).length > 0) {
                info.clarity.forEach(item => {
                    const res = item.title;
                    const weight = RES_WEIGHT[res] || 0;
                    if (item.path && item.path.result) {
                        const url = item.path.result;
                        saveResult(epName, url, res, weight);
                    }
                });
            }

            if (info.flvPathList) {
                info.flvPathList.forEach(item => {
                    if (item.result && item.result.includes('m3u8')) {
                        const res = item.bitrate ? item.bitrate.toString() : "720";
                        saveResult(epName, item.result, res, RES_WEIGHT[res] || 2);
                    }
                });
            }
        } catch (e) {
            console.error("解析 JSON 出错", e);
        }
    }

    function saveResult(epName, url, res, weight) {
        if (!url || !url.includes('http')) return;
        const existing = results.get(epName);
        if (!existing || weight > existing.weight || (url.includes('chunklist') && !existing.url.includes('chunklist'))) {
            results.set(epName, { url, res, weight });
            console.log(`%c[精细捕获] 第 ${epName} 集 -> ${res}P`, "color: #00ff00; font-weight: bold;");
            renderUI();
        }
    }

    // --- 网络拦截器 ---
    const rawFetch = window.fetch;
    window.fetch = async (...args) => {
        const resp = await rawFetch(...args);
        const url = typeof args[0] === 'string' ? args[0] : args[0].url;
        if (url.includes('/video/play')) {
            const clone = resp.clone();
            clone.json().then(json => parseVideoJson(json)).catch(()=>{});
        }
        return resp;
    };

    const rawOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        if (url.includes('/video/play')) {
            this.addEventListener('load', function() {
                try {
                    const json = JSON.parse(this.responseText);
                    parseVideoJson(json);
                } catch(e){}
            });
        }
        return rawOpen.apply(this, arguments);
    };

    // --- UI 界面渲染逻辑 ---
    GM_addStyle(`
        #v10-box {
            position: fixed; top: 10px; right: 10px; z-index: 2147483647;
            background: rgba(15,15,15,0.95); color: #eee; border: 1px solid #d4a017;
            padding: 12px; width: 320px; border-radius: 10px; font-family: 'Segoe UI', sans-serif;
            box-shadow: 0 10px 30px rgba(0,0,0,0.8);
            display: none; /* 默认隐藏 */
        }
        .v10-title { color: #d4a017; font-weight: bold; text-align: center; margin-bottom: 10px; font-size:16px; border-bottom: 1px solid #444; padding-bottom:8px; }
        .v10-item { font-size: 12px; border-bottom: 1px solid #333; padding: 8px 0; display: flex; justify-content: space-between; align-items: center; }
        .v10-btn { width: 100%; margin-top: 8px; cursor: pointer; background: #d4a017; border: none; padding: 10px; font-weight: bold; color: #000; border-radius: 5px; transition: 0.2s; }
        .v10-btn:hover { background: #f1c40f; }
        #v10-list { max-height: 300px; overflow-y: auto; margin: 8px 0; }
        .v10-res { background: #27ae60; color: white; padding: 1px 5px; border-radius: 3px; font-size: 10px; font-weight: bold; }
    `);

    // 检查是否应该显示 UI
    function checkUrlAndToggleUI() {
        const box = document.getElementById('v10-box');
        if (window.location.href.includes('/play/')) {
            if (!box) {
                createUI();
            } else {
                box.style.display = 'block';
            }
        } else if (box) {
            box.style.display = 'none';
        }
    }

    function createUI() {
        if (document.getElementById('v10-box')) return;
        if (!document.body) return;

        const scriptVersion = GM_info.script.version;
        const box = document.createElement('div');
        box.id = 'v10-box';
        box.innerHTML = `
            <div class="v10-title">IYF 智能解析 v${scriptVersion}</div>
            <div id="v10-status" style="font-size:11px; color:#888; text-align:center;">等待 API 触发...</div>
            <div id="v10-list"></div>
            <button id="v10-btn-auto" class="v10-btn">一键顺序获取 (从当前集开始)</button>
            <button id="v10-btn-copy" class="v10-btn" style="background:#2980b9; color:#fff;">复制 M3U8 列表</button>
            <button id="v10-btn-clear" class="v10-btn" style="background:#444; color:#ccc;">重置</button>
        `;
        document.body.appendChild(box);

        document.getElementById('v10-btn-auto').onclick = autoPlay;
        document.getElementById('v10-btn-clear').onclick = () => { results.clear(); renderUI(); };
        document.getElementById('v10-btn-copy').onclick = () => {
            let text = "";
            const title = document.title.split('-')[0].trim();
            const sortedKeys = Array.from(results.keys()).sort((a,b)=> (parseInt(a.replace(/[^0-9]/g, ''))||0) - (parseInt(b.replace(/[^0-9]/g, ''))||0));
            sortedKeys.forEach(k => {
                const v = results.get(k);
                text += `${title}_E${k}_${v.res}.m3u8$${v.url}\n`;
            });
            GM_setClipboard(text);
            alert("列表已复制！");
        };

        // 初次创建后根据当前 URL 决定是否显示
        box.style.display = window.location.href.includes('/play/') ? 'block' : 'none';
        renderUI();
    }

    function renderUI() {
        const list = document.getElementById('v10-list');
        if (!list) return;
        list.innerHTML = '';
        const sorted = Array.from(results.keys()).sort((a,b) => {
            const numA = parseInt(a.replace(/[^0-9]/g, '')) || 0;
            const numB = parseInt(b.replace(/[^0-9]/g, '')) || 0;
            return numA - numB;
        });

        sorted.forEach(k => {
            const v = results.get(k);
            const div = document.createElement('div');
            div.className = 'v10-item';
            div.innerHTML = `<span>第 <b>${k}</b> 集</span><span class="v10-res">${v.res}P</span>`;
            list.appendChild(div);
        });
        const status = document.getElementById('v10-status');
        if (status) status.innerText = `已精准捕获 ${results.size} 条播放数据`;
    }

    async function autoPlay() {
        const selectors = '.media-button, .playlist-item, [class*="episode"], .list-item, .play-list-item';
        const allBtns = Array.from(document.querySelectorAll(selectors))
                             .filter(el => el.innerText.trim() && el.offsetHeight > 0);

        if (allBtns.length === 0) return alert("请先展开剧集列表或确保列表已加载");

        // 基于当前 URL 的参数定位当前集数
        const currentUrl = window.location.href;
        let startIndex = allBtns.findIndex(btn => {
            // 尝试从按钮或按钮内的 A 标签获取链接
            const link = btn.href || btn.getAttribute('href') || (btn.querySelector('a') ? btn.querySelector('a').getAttribute('href') : '');
            // 如果 URL 包含按钮的 href 信息，判定为当前集
            return link && currentUrl.includes(link);
        });

        // 备选方案：如果链接匹配失败，使用 CSS 类名定位
        if (startIndex === -1) {
            startIndex = allBtns.findIndex(btn =>
                btn.classList.contains('active') ||
                btn.classList.contains('selected') ||
                btn.classList.contains('current') ||
                (btn.parentElement && btn.parentElement.classList.contains('active'))
            );
        }

        const startFrom = startIndex === -1 ? 0 : startIndex;
        const targetBtns = allBtns.slice(startFrom);

        if(!confirm(`当前定位到第 ${startFrom + 1} 个按钮。将从此处开始遍历剩余 ${targetBtns.length} 个剧集。 是否继续？`)) return;

        for (let i = 0; i < targetBtns.length; i++) {
            targetBtns[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
            targetBtns[i].click();
            await new Promise(r => setTimeout(r, 4000));
        }
        alert("遍历完成");
    }

    // 初始化：由于是 SPA 网站，需要监听 URL 变化和 DOM 加载
    window.addEventListener('popstate', checkUrlAndToggleUI);
    // 劫持 pushState 以感知单页路由切换
    const _historyPushState = history.pushState;
    history.pushState = function() {
        _historyPushState.apply(this, arguments);
        setTimeout(checkUrlAndToggleUI, 500);
    };

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', checkUrlAndToggleUI);
    } else {
        checkUrlAndToggleUI();
    }

    // 兜底检查，防止某些动态加载未触发
    setInterval(checkUrlAndToggleUI, 2000);

})();
