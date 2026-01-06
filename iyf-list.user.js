// ==UserScript==
// @name         爱壹帆 (IYF) 获取列表
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  基于 V3 API 结构化解析，精准捕获集数、分辨率和真实 M3U8 地址。修复界面不显示问题。
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

    // --- 网络拦截器 (必须在 document-start 立即执行) ---
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
        }
        .v10-title { color: #d4a017; font-weight: bold; text-align: center; margin-bottom: 10px; font-size:16px; border-bottom: 1px solid #444; padding-bottom:8px; }
        .v10-item { font-size: 12px; border-bottom: 1px solid #333; padding: 8px 0; display: flex; justify-content: space-between; align-items: center; }
        .v10-btn { width: 100%; margin-top: 8px; cursor: pointer; background: #d4a017; border: none; padding: 10px; font-weight: bold; color: #000; border-radius: 5px; transition: 0.2s; }
        .v10-btn:hover { background: #f1c40f; }
        #v10-list { max-height: 300px; overflow-y: auto; margin: 8px 0; }
        .v10-res { background: #27ae60; color: white; padding: 1px 5px; border-radius: 3px; font-size: 10px; font-weight: bold; }
    `);

    // 确保 UI 只创建一次
    function createUI() {
        if (document.getElementById('v10-box')) return;
        if (!document.body) {
            // 如果 body 还没准备好，等待 100 毫秒再试
            setTimeout(createUI, 100);
            return;
        }

        const box = document.createElement('div');
        box.id = 'v10-box';
        box.innerHTML = `
            <div class="v10-title">IYF 智能解析 v10.0</div>
            <div id="v10-status" style="font-size:11px; color:#888; text-align:center;">等待 API 触发...</div>
            <div id="v10-list"></div>
            <button id="v10-btn-auto" class="v10-btn">一键点播全集 (触发API)</button>
            <button id="v10-btn-copy" class="v10-btn" style="background:#2980b9; color:#fff;">复制 M3U8 列表</button>
            <button id="v10-btn-clear" class="v10-btn" style="background:#444; color:#ccc;">重置</button>
        `;
        document.body.appendChild(box);

        // 绑定事件
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
        document.getElementById('v10-status').innerText = `已精准捕获 ${results.size} 条播放数据`;
    }

    async function autoPlay() {
        // 尝试多个可能的按钮选择器
        const btns = Array.from(document.querySelectorAll('.media-button, .playlist-item, [class*="episode"], .list-item'))
                          .filter(el => el.innerText.trim() && el.offsetHeight > 0);
        if (btns.length === 0) return alert("请先展开剧集列表或确保列表已加载");

        if(!confirm(`检测到 ${btns.length} 个剧集，是否开始自动点击触发 API？\n(过程约耗时 ${btns.length * 4} 秒)`)) return;

        for (let i = 0; i < btns.length; i++) {
            btns[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
            btns[i].click();
            await new Promise(r => setTimeout(r, 4000));
        }
        alert("全集遍历完成");
    }

    // 初始化 UI
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }

})();
