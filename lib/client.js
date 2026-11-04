window.__ModuleLoader__.load({id:"dsh-deepseek-delegate",factory:(require)=>{var module={exports:{}};var exports=module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/ui/client.jsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);

// src/ui/transport.mjs
var PANEL_CHANNEL = "/api";
var PANEL_ENDPOINT = "deepseek-delegate/request";
function createPanelApi(getConnection) {
  return async (endpoint, data, method) => {
    let result;
    try {
      result = await getConnection().rpc.call(PANEL_CHANNEL, PANEL_ENDPOINT, {
        endpoint,
        method: method || (data ? "POST" : "GET"),
        data
      }, AbortSignal.timeout(12e3));
    } catch {
      throw new Error("\u59D4\u6D3E\u670D\u52A1\u6682\u4E0D\u53EF\u7528\uFF0C\u6B63\u5728\u91CD\u65B0\u8FDE\u63A5\u3002\u8BF7\u786E\u8BA4\u63D2\u4EF6\u5DF2\u542F\u7528\u3002");
    }
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
}

// src/ui/client.jsx
var import_jsx_runtime = require("react/jsx-runtime");
var PANEL = "deepseek-delegate";
var statuses = { queued: "\u6392\u961F\u4E2D", running: "\u8FD0\u884C\u4E2D", completed: "\u5DF2\u5B8C\u6210", failed: "\u5931\u8D25", cancelled: "\u5DF2\u53D6\u6D88", interrupted: "\u5DF2\u4E2D\u65AD" };
var active = (task) => ["queued", "running"].includes(task?.status);
var retryable = (task) => ["failed", "interrupted"].includes(task?.status);
var resumable = (task) => task?.resumable === true;
var DEFAULT_RESUME_PROMPT = "\u7EE7\u7EED\u5B8C\u6210\u539F\u4EFB\u52A1\u3002\u4E0A\u6B21\u6267\u884C\u56E0\u8D85\u65F6\u4E2D\u65AD\uFF0C\u8BF7\u4ECE\u5F53\u524D\u8FDB\u5EA6\u7EE7\u7EED\uFF0C\u4E0D\u8981\u91CD\u590D\u5DF2\u7ECF\u5B8C\u6210\u7684\u5DE5\u4F5C\uFF1B\u5B8C\u6210\u540E\u7ED9\u51FA\u6700\u7EC8\u4EA4\u4ED8\u8BF4\u660E\u3002";
var attemptOf = (task) => task?.attempt || 1;
var time = (value) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "\u2014";
var tokenCount = (value) => Number.isSafeInteger(value) ? value.toLocaleString("zh-CN") : "\u2014";
var usageLabel = (usage) => usage ? `\u65B0\u589E ${tokenCount(usage.billableTokens)}` : "Token \u672A\u62A5\u544A";
var reasoningLabels = { default: "\u6A21\u578B\u9ED8\u8BA4", off: "\u5173\u95ED", low: "\u4F4E", medium: "\u4E2D", high: "\u9AD8", max: "\u6700\u9AD8" };
function Icon({ size = 20 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.6", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "3", y: "3", width: "7", height: "7", rx: "2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "14", y: "14", width: "7", height: "7", rx: "2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M14 6h3a1 1 0 0 1 1 1v3M10 18H7a1 1 0 0 1-1-1v-3M15 8l3 3 3-3M9 16l-3-3-3 3" })
  ] });
}
function Badge({ task }) {
  const label = task.errorCode === "timeout" ? "\u8D85\u65F6" : statuses[task.status] || task.status;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: `dd-badge dd-${task.status}`, children: [
    active(task) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
    label
  ] });
}
function Field({ label, hint, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dd-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: label }),
    children,
    hint && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: hint })
  ] });
}
function Settings({ state, onSave, busy }) {
  const [form, setForm] = (0, import_react.useState)(state.config);
  const change = (key, value) => setForm((p) => ({ ...p, [key]: value }));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { className: "dd-settings", onSubmit: (e) => {
    e.preventDefault();
    onSave(form);
  }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-section-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u59D4\u6D3E\u8BBE\u7F6E" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u65B0\u4EFB\u52A1\u4F7F\u7528\u8FD9\u91CC\u7684\u914D\u7F6E\u3002\u6B63\u5728\u6267\u884C\u7684\u4EFB\u52A1\u4FDD\u7559\u6D3E\u53D1\u65F6\u7684\u914D\u7F6E\u3002" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Field, { label: "\u6A21\u578B\u8DEF\u7531", hint: "\u683C\u5F0F\uFF1A\u4F9B\u5E94\u5546 / \u6A21\u578B\u3002\u652F\u6301\u5728\u4E0B\u65B9\u586B\u5199\u81EA\u5DF1\u7684\u8DEF\u7531\u3002", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { required: true, list: "dd-routes", value: form.modelRoute, onChange: (e) => change("modelRoute", e.target.value) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("datalist", { id: "dd-routes", children: state.routes.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: r }, r)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "\u9ED8\u8BA4\u5DE5\u4F5C\u76EE\u5F55", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { required: true, value: form.cwd, onChange: (e) => change("cwd", e.target.value) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "\u5141\u8BB8\u7684\u5DE5\u4F5C\u76EE\u5F55", hint: "\u53EF\u9009\uFF0C\u9017\u53F7\u5206\u9694\u7684\u7EDD\u5BF9\u8DEF\u5F84\uFF1B\u7559\u7A7A\u4E0D\u9650\u5236\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { value: (form.allowedRoots || []).join(", "), onChange: (e) => change("allowedRoots", e.target.value.split(",").map((value) => value.trim()).filter(Boolean)) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "\u4EFB\u52A1\u6743\u9650", hint: "\u81EA\u52A8\u6267\u884C\u65F6\u4E0D\u4F1A\u5F39\u51FA\u4EA4\u4E92\u5BA1\u6279\uFF1B\u9700\u8981\u5BA1\u6279\u7684\u64CD\u4F5C\u4F1A\u5931\u8D25\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { value: form.permissionMode, onChange: (e) => change("permissionMode", e.target.value), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "read-only", children: "\u53EA\u8BFB" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "workspace-write", children: "\u5141\u8BB8\u4FEE\u6539\u5DE5\u4F5C\u76EE\u5F55" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "danger-full-access", children: "\u5B8C\u5168\u8BBF\u95EE" })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "\u9ED8\u8BA4\u601D\u8003\u5F3A\u5EA6", hint: "\u6A21\u578B\u9ED8\u8BA4\u4F1A\u6CBF\u7528\u6A21\u578B\u6216\u4F9B\u5E94\u5546\u81EA\u8EAB\u7684\u8BBE\u7F6E\uFF1B\u5177\u4F53\u6863\u4F4D\u53D6\u51B3\u4E8E\u6A21\u578B\u652F\u6301\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", { value: form.reasoningEffort || "default", onChange: (e) => change("reasoningEffort", e.target.value), children: Object.entries(reasoningLabels).map(([value, label]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value, children: label }, value)) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "\u540C\u65F6\u6267\u884C\u4EFB\u52A1\u6570", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "number", min: "1", max: "4", required: true, value: form.maxConcurrent, onChange: (e) => change("maxConcurrent", Number(e.target.value)) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "\u4EFB\u52A1\u8D85\u65F6\uFF08\u79D2\uFF09", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "number", min: "10", max: "3600", required: true, value: form.timeoutSeconds, onChange: (e) => change("timeoutSeconds", Number(e.target.value)) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "\u5DF2\u7ED3\u675F\u4EFB\u52A1\u4FDD\u7559\u6570", hint: "\u9ED8\u8BA4 1000\uFF0C0 \u8868\u793A\u4E0D\u9650\u3002\u4FDD\u5B58\u540E\u4F1A\u6E05\u7406\u6700\u8001\u7684\u5DF2\u7ED3\u675F\u8BB0\u5F55\uFF0C\u5305\u542B\u5176\u5E42\u7B49\u952E\uFF1B\u6392\u961F\u548C\u8FD0\u884C\u4EFB\u52A1\u4E0D\u53D7\u5F71\u54CD\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "number", min: "0", max: "10000", required: true, value: form.historyLimit ?? 1e3, onChange: (e) => change("historyLimit", Number(e.target.value)) }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Harness \u8FDE\u63A5" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "CLI \u6216\u684C\u9762\u7A0B\u5E8F\u8DEF\u5F84", hint: `\u7559\u7A7A\u81EA\u52A8\u68C0\u6D4B${state.launcher ? `\uFF1A${state.launcher}` : "\u3002\u652F\u6301\u5B98\u65B9 dsh.cmd\u3001DeepSeek Harness.exe \u6216 DSH Desktop.exe\u3002"}`, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { value: form.executable, placeholder: "\u81EA\u52A8\u68C0\u6D4B", onChange: (e) => change("executable", e.target.value) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dd-check", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: form.reuseSavedAuth, onChange: (e) => change("reuseSavedAuth", e.target.checked) }),
      "\u590D\u7528 Harness \u5DF2\u4FDD\u5B58\u7684\u767B\u5F55\u4E0E\u51ED\u636E"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dd-check", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: form.reuseProviders, onChange: (e) => change("reuseProviders", e.target.checked) }),
      "\u590D\u7528\u684C\u9762\u914D\u7F6E\u4E2D\u7684\u7B2C\u4E09\u65B9\u4F9B\u5E94\u5546"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "\u4F9B\u5E94\u5546\u914D\u7F6E\u6587\u4EF6", hint: "\u8BFB\u53D6\u5176\u4E2D\u7684\u4F9B\u5E94\u5546\u58F0\u660E\uFF0C\u51ED\u636E\u4ECD\u7531 Harness \u7BA1\u7406\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { disabled: !form.reuseProviders, value: form.providerConfigPath, onChange: (e) => change("providerConfigPath", e.target.value) }) }),
    (state.launcherError || state.providerError) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: "dd-error", children: state.launcherError || state.providerError }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dd-primary", disabled: busy, type: "submit", children: "\u4FDD\u5B58\u8BBE\u7F6E" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "dd-subtle", children: [
      "\u6570\u636E\u76EE\u5F55\uFF1A",
      state.dataDir
    ] })
  ] });
}
function Integration({ state, onNotice }) {
  const [format, setFormat] = (0, import_react.useState)("toml");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.integration[format]);
      onNotice("\u5DF2\u590D\u5236\u8FDE\u63A5\u914D\u7F6E");
    } catch {
      onNotice("\u65E0\u6CD5\u8BBF\u95EE\u526A\u8D34\u677F\uFF0C\u8BF7\u9009\u4E2D\u4E0B\u9762\u7684\u914D\u7F6E\u624B\u52A8\u590D\u5236\u3002");
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-settings", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-section-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u8FDE\u63A5 Codex" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u6DFB\u52A0\u4E00\u6B21 MCP \u914D\u7F6E\uFF0C\u4E4B\u540E\u53EF\u76F4\u63A5\u5728 Codex \u4E2D\u59D4\u6D3E\u4EFB\u52A1\u3002" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ol", { className: "dd-steps", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "\u4FDD\u6301 Harness \u8FD0\u884C\uFF0C\u5E76\u542F\u7528\u672C\u63D2\u4EF6\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
        "\u5C06\u4E0B\u9762\u7684\u914D\u7F6E\u52A0\u5165 Codex \u7684 ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: "config.toml" }),
        "\u3002"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "\u91CD\u65B0\u52A0\u8F7D Codex \u7684 MCP \u8FDE\u63A5\uFF0C\u5728\u65B0\u5BF9\u8BDD\u4E2D\u6D4B\u8BD5\u5DE5\u5177\u3002" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-code-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-switch", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { "aria-pressed": format === "toml", onClick: () => setFormat("toml"), children: "Codex \xB7 TOML" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { "aria-pressed": format === "json", onClick: () => setFormat("json"), children: "\u901A\u7528 JSON" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: copy, children: "\u590D\u5236\u914D\u7F6E" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: "dd-code", tabIndex: "0", children: state.integration[format] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "\u53EF\u7528\u5DE5\u5177" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dd-tools", children: [["delegate_to_deepseek", "\u6D3E\u53D1\u4EFB\u52A1\u6216\u7EED\u804A"], ["wait_task", "\u7B49\u5F85\u4EFB\u52A1\u5B8C\u6210"], ["get_task", "\u8BFB\u53D6\u56DE\u7B54\u4E0E\u65E5\u5FD7"], ["cancel_task", "\u53D6\u6D88\u4EFB\u52A1"], ["retry_task", "\u624B\u52A8\u91CD\u8BD5\u5931\u8D25\u6216\u4E2D\u65AD\u7684\u4EFB\u52A1"], ["resume_task", "\u5728\u8D85\u65F6/\u4E2D\u65AD\u7684\u539F\u4F1A\u8BDD\u4E2D\u7EE7\u7EED"], ["list_tasks", "\u67E5\u770B\u4EFB\u52A1\u5217\u8868"], ["get_deepseek_settings", "\u8BFB\u53D6\u5F53\u524D\u8BBE\u7F6E"]].map(([name, label]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: name }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: label })
    ] }, name)) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dd-subtle", children: "MCP \u4E0E\u8FD9\u91CC\u5171\u7528\u4EFB\u52A1\u8BB0\u5F55\u3002\u5173\u95ED Harness \u4F1A\u4E2D\u65AD\u4EFB\u52A1\uFF0C\u8FDE\u63A5\u7A0B\u5E8F\u4F1A\u5728\u4E0B\u6B21\u8C03\u7528\u65F6\u91CD\u65B0\u5BFB\u627E\u63D2\u4EF6\u3002" })
  ] });
}
function Page({ api }) {
  const [state, setState] = (0, import_react.useState)(null), [tab, setTab] = (0, import_react.useState)("tasks");
  const [selected, setSelected] = (0, import_react.useState)(null), [detail, setDetail] = (0, import_react.useState)(null);
  const [prompt, setPrompt] = (0, import_react.useState)(""), [cwd, setCwd] = (0, import_react.useState)(""), [parent, setParent] = (0, import_react.useState)(null);
  const [timeoutSeconds, setTimeoutSeconds] = (0, import_react.useState)(""), [resumeForm, setResumeForm] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)(""), [notice, setNotice] = (0, import_react.useState)(""), [busy, setBusy] = (0, import_react.useState)(false);
  const [offset, setOffset] = (0, import_react.useState)(0), [status, setStatus] = (0, import_react.useState)("");
  const submission = (0, import_react.useRef)(null);
  const selection = (0, import_react.useRef)(null);
  selection.current = selected;
  (0, import_react.useEffect)(() => {
    let disposed = false, pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const next = await api(`/api/state?limit=50&offset=${offset}${status ? `&status=${status}` : ""}`);
        if (offset > 0 && offset >= next.taskPage.total) {
          if (!disposed) setOffset(Math.max(0, Math.floor((next.taskPage.total - 1) / 50) * 50));
          return;
        }
        const taskId = selection.current;
        let task = null;
        if (taskId) {
          try {
            task = await api(`/api/tasks/${taskId}`);
          } catch (e) {
            if (!e.message.includes("\u4EFB\u52A1\u4E0D\u5B58\u5728")) throw e;
            if (!disposed && selection.current === taskId) {
              setSelected(null);
              setNotice("\u8FD9\u6761\u4EFB\u52A1\u8BB0\u5F55\u5DF2\u88AB\u5386\u53F2\u4FDD\u7559\u7B56\u7565\u6E05\u7406\u3002");
            }
          }
        }
        if (!disposed) {
          setState(next);
          setError("");
          if (selection.current === taskId) setDetail(task);
        }
      } catch (e) {
        if (!disposed) setError(e.message);
      } finally {
        pending = false;
      }
    }
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [api, offset, status]);
  (0, import_react.useEffect)(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  async function action(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const choose = (task) => {
    setSelected(task.id);
    setDetail(null);
    setParent(null);
    setResumeForm(null);
  };
  const newTask = () => {
    submission.current = null;
    setSelected(null);
    setDetail(null);
    setParent(null);
    setPrompt("");
    setCwd("");
    setTimeoutSeconds("");
    setResumeForm(null);
    setTab("tasks");
  };
  const submit = (e) => {
    e.preventDefault();
    action(async () => {
      const args = { prompt, ...cwd ? { cwd } : {}, ...parent ? { continueTaskId: parent.id } : {}, ...timeoutSeconds ? { timeoutSeconds: Number(timeoutSeconds) } : {} };
      const fingerprint = JSON.stringify(args);
      if (submission.current?.fingerprint !== fingerprint) submission.current = { fingerprint, idempotencyKey: Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("") };
      const task = await api("/api/tasks", { ...args, idempotencyKey: submission.current.idempotencyKey });
      submission.current = null;
      setOffset(0);
      setStatus("");
      setDetail(task);
      setSelected(task.id);
      setParent(null);
      setPrompt("");
      setState((p) => ({ ...p, tasks: [task, ...p.tasks.filter((t) => t.id !== task.id)].slice(0, 50) }));
    });
  };
  const resume = () => {
    setParent(detail);
    setCwd(detail.cwd);
    setSelected(null);
    setDetail(null);
    setPrompt("");
    setResumeForm(null);
    setTimeoutSeconds("");
  };
  const retry = () => action(async () => {
    const task = await api(`/api/tasks/${detail.id}/retry`, {});
    setOffset(0);
    setStatus("");
    setSelected(task.id);
    setDetail(task);
    setNotice("\u5DF2\u521B\u5EFA\u91CD\u8BD5\u4EFB\u52A1\uFF0C\u65B0\u4EFB\u52A1\u5DF2\u8FDB\u5165\u961F\u5217\u3002");
  });
  const startResume = () => setResumeForm({ id: detail.id, prompt: DEFAULT_RESUME_PROMPT, timeoutSeconds: detail.timeoutSeconds ? String(detail.timeoutSeconds) : "" });
  const submitResume = (e) => {
    e.preventDefault();
    action(async () => {
      const payload = { prompt: resumeForm.prompt, ...resumeForm.timeoutSeconds ? { timeoutSeconds: Number(resumeForm.timeoutSeconds) } : {} };
      const task = await api(`/api/tasks/${resumeForm.id}/resume`, payload);
      setResumeForm(null);
      setOffset(0);
      setStatus("");
      setSelected(task.id);
      setDetail(task);
      setNotice("\u5DF2\u521B\u5EFA\u7EED\u8DD1\u4EFB\u52A1\uFF0C\u6B63\u5728\u539F\u4F1A\u8BDD\u4E2D\u7EE7\u7EED\u3002");
    });
  };
  const testConnection = () => action(async () => {
    const task = await api("/api/tasks", { prompt: "\u8FDE\u901A\u6027\u6D4B\u8BD5\uFF1A\u4E0D\u8981\u8C03\u7528\u5DE5\u5177\uFF0C\u4E0D\u8981\u8BFB\u53D6\u6216\u4FEE\u6539\u6587\u4EF6\u3002\u8BF7\u53EA\u56DE\u590D DEEPSEEK_PLUGIN_OK\u3002" });
    setOffset(0);
    setStatus("");
    setTab("tasks");
    setSelected(task.id);
    setDetail(task);
    setParent(null);
    setState((p) => ({ ...p, tasks: [task, ...p.tasks].slice(0, 50) }));
  });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dd-root", "aria-label": "DeepSeek \u59D4\u6D3E\u7BA1\u7406", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dd-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-heading", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dd-logo", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { size: 23 }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "DeepSeek \u59D4\u6D3E" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u628A\u4EFB\u52A1\u4EA4\u7ED9 DeepSeek\uFF0C\u8FDB\u5EA6\u7559\u5728\u8FD9\u91CC\u3002" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: `dd-connection ${state && !error ? "dd-online" : ""}`, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
        state && !error ? "\u63D2\u4EF6\u5DF2\u8FDE\u63A5" : "\u7B49\u5F85\u8FDE\u63A5"
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", { className: "dd-nav", "aria-label": "\u59D4\u6D3E\u7BA1\u7406\u5BFC\u822A", children: [
      [["tasks", "\u4EFB\u52A1"], ["settings", "\u8BBE\u7F6E"], ["integration", "MCP \u8FDE\u63A5"]].map(([id, name]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { "aria-current": tab === id ? "page" : void 0, onClick: () => setTab(id), children: name }, id)),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {}),
      state && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: testConnection, children: "\u8FDE\u901A\u6027\u6D4B\u8BD5 \u2197" })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "alert", className: "dd-alert", children: error }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "status", className: "dd-notice", children: notice }),
    !state ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dd-loading", children: "\u6B63\u5728\u8FDE\u63A5\u59D4\u6D3E\u670D\u52A1\u2026" }) : tab === "settings" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Settings, { state, busy, onSave: (form) => action(async () => {
      const config = await api("/api/config", form, "PUT");
      setState((p) => ({ ...p, config }));
      setNotice("\u8BBE\u7F6E\u5DF2\u4FDD\u5B58");
    }) }) : tab === "integration" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Integration, { state, onNotice: setNotice }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-workspace", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", { className: "dd-tasklist", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-list-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u4FDD\u7559\u4EFB\u52A1 ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: state.usage?.taskCount ?? state.tasks.length }),
            state.usage?.reportedTaskCount > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { className: "dd-usage-summary", children: [
              "\xB7 \u5DF2\u4FDD\u7559\u8BB0\u5F55\u65B0\u589E ",
              tokenCount(state.usage.billableTokens),
              " tokens"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: newTask, "aria-label": "\u65B0\u5EFA\u4EFB\u52A1", children: "\uFF0B \u65B0\u5EFA" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dd-task-filter", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u4EFB\u52A1\u72B6\u6001" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { value: status, onChange: (e) => {
            setStatus(e.target.value);
            setOffset(0);
          }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u5168\u90E8\u72B6\u6001" }),
            Object.entries(statuses).map(([value, label]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value, children: label }, value))
          ] })
        ] }),
        !state.tasks.length && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dd-empty-list", children: status ? "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u4EFB\u52A1\u3002" : "\u8FD8\u6CA1\u6709\u4EFB\u52A1\uFF0C\u4ECE\u53F3\u4FA7\u6D3E\u53D1\u7B2C\u4E00\u4E2A\u4EFB\u52A1\u3002" }),
        state.tasks.map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { className: `dd-task ${selected === task.id ? "dd-selected" : ""}`, onClick: () => choose(task), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { task }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: new Date(task.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: task.prompt }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: task.preview || task.modelRoute }),
          task.usage && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { className: "dd-task-usage", children: usageLabel(task.usage) })
        ] }, task.id)),
        state.taskPage && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-pagination", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: offset === 0, onClick: () => setOffset(Math.max(0, offset - 50)), children: "\u4E0A\u4E00\u9875" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            state.taskPage.total ? `${state.taskPage.offset + 1}\u2013${state.taskPage.offset + state.tasks.length}` : "0",
            " / ",
            state.taskPage.total
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: !state.taskPage.hasMore, onClick: () => setOffset(state.taskPage.nextOffset), children: "\u4E0B\u4E00\u9875" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", { className: "dd-content", children: !selected ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { className: "dd-compose", onSubmit: submit, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-section-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dd-eyebrow", children: parent ? "\u7EE7\u7EED\u539F\u751F\u4F1A\u8BDD" : "\u65B0\u4EFB\u52A1" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: parent ? "\u7EE7\u7EED\u8FD9\u9879\u5DE5\u4F5C" : "\u8BA9 DeepSeek \u5E2E\u4F60\u5B8C\u6210\u4EFB\u52A1" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u6E05\u695A\u63CF\u8FF0\u76EE\u6807\u3001\u4E0A\u4E0B\u6587\u548C\u671F\u671B\u7ED3\u679C\u3002" })
        ] }),
        parent && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-parent", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u63A5\u7EED\uFF1A",
            parent.prompt.slice(0, 100)
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: newTask, children: "\u53D6\u6D88\u7EED\u804A" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "\u4EFB\u52A1\u5185\u5BB9", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { required: true, rows: 9, maxLength: 65536, value: prompt, onChange: (e) => setPrompt(e.target.value), placeholder: "\u4F8B\u5982\uFF1A\u5206\u6790\u5F53\u524D\u9879\u76EE\u7684\u76EE\u5F55\u7ED3\u6784\uFF0C\u8BF4\u660E\u5165\u53E3\u548C\u4E3B\u8981\u6A21\u5757\uFF0C\u4E0D\u4FEE\u6539\u6587\u4EF6\u3002" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "\u5DE5\u4F5C\u76EE\u5F55", hint: parent ? "\u7EED\u804A\u6CBF\u7528\u539F\u4EFB\u52A1\u7684\u5DE5\u4F5C\u76EE\u5F55\u548C\u6A21\u578B\u8DEF\u7531\u3002" : "\u7559\u7A7A\u4F7F\u7528\u8BBE\u7F6E\u4E2D\u7684\u9ED8\u8BA4\u76EE\u5F55\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { value: cwd, disabled: !!parent, placeholder: state.config.cwd, onChange: (e) => setCwd(e.target.value) }) }),
        !parent && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "\u8D85\u65F6\uFF08\u79D2\uFF09", hint: "\u7559\u7A7A\u4F7F\u7528\u8BBE\u7F6E\u4E2D\u7684\u9ED8\u8BA4\u503C\uFF1B\u957F\u4EFB\u52A1\u53EF\u8C03\u5927\uFF0C\u6700\u5927 3600\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "number", min: "10", max: "3600", value: timeoutSeconds, placeholder: String(state.config.timeoutSeconds), onChange: (e) => setTimeoutSeconds(e.target.value) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-compose-footer", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: state.config.modelRoute }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
              reasoningLabels[state.config.reasoningEffort || "default"],
              " \xB7 ",
              { "read-only": "\u53EA\u8BFB", "workspace-write": "\u53EF\u4FEE\u6539\u5DE5\u4F5C\u76EE\u5F55", "danger-full-access": "\u5B8C\u5168\u8BBF\u95EE" }[state.config.permissionMode]
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dd-primary", disabled: busy || !prompt.trim(), type: "submit", children: busy ? "\u6B63\u5728\u6D3E\u53D1\u2026" : parent ? "\u7EED\u804A \u2192" : "\u6D3E\u53D1\u4EFB\u52A1 \u2192" })
        ] })
      ] }) : !detail || detail.id !== selected ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dd-loading", children: "\u8BFB\u53D6\u4EFB\u52A1\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-detail", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-detail-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { task: detail }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {}),
          active(detail) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => action(async () => setDetail(await api(`/api/tasks/${detail.id}/cancel`, {}))), children: "\u53D6\u6D88\u4EFB\u52A1" }),
          detail.status === "completed" && detail.sessionId && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: resume, children: "\u7EE7\u7EED\u5BF9\u8BDD \u2192" }),
          resumable(detail) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: startResume, children: "\u7EE7\u7EED\u8FD0\u884C \u2192" }),
          retryable(detail) && !resumable(detail) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dd-retry", disabled: busy, onClick: retry, children: "\u91CD\u8BD5\u4EFB\u52A1" })
        ] }),
        resumeForm && resumeForm.id === detail.id && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { className: "dd-settings dd-resume", onSubmit: submitResume, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-section-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "\u7EE7\u7EED\u8FD0\u884C" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u5728\u539F\u4F1A\u8BDD\u4E2D\u63A5\u7740\u6267\u884C\uFF0C\u9ED8\u8BA4\u4E0D\u4F1A\u91CD\u590D\u5DF2\u5B8C\u6210\u7684\u5DE5\u4F5C\u3002" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "\u7EED\u8DD1\u63D0\u793A", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { rows: 4, value: resumeForm.prompt, onChange: (e) => setResumeForm((p) => ({ ...p, prompt: e.target.value })) }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "\u8D85\u65F6\uFF08\u79D2\uFF09", hint: "\u7559\u7A7A\u6CBF\u7528\u539F\u4EFB\u52A1\u7684\u8D85\u65F6\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "number", min: "10", max: "3600", value: resumeForm.timeoutSeconds, onChange: (e) => setResumeForm((p) => ({ ...p, timeoutSeconds: e.target.value })) }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-compose-footer", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => setResumeForm(null), children: "\u53D6\u6D88" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dd-primary", disabled: busy, type: "submit", children: "\u7EE7\u7EED\u8FD0\u884C \u2192" })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u4EFB\u52A1\u8BE6\u60C5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: "dd-prompt", children: detail.prompt }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-metadata", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u6A21\u578B ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: detail.modelRoute })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u601D\u8003\u5F3A\u5EA6 ",
            reasoningLabels[detail.reasoningEffort] || reasoningLabels.default
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u76EE\u5F55 ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: detail.cwd })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u5C1D\u8BD5 ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: attemptOf(detail) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u8D85\u65F6 ",
            detail.timeoutSeconds ? `${detail.timeoutSeconds} \u79D2` : "\u2014"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            usageLabel(detail.usage),
            detail.usage && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
              "\uFF08\u8F93\u5165 ",
              tokenCount(detail.usage.inputTokens),
              " / \u8F93\u51FA ",
              tokenCount(detail.usage.outputTokens),
              detail.usage.thoughtTokens != null ? ` / \u601D\u8003 ${tokenCount(detail.usage.thoughtTokens)}` : "",
              detail.usage.cachedReadTokens != null ? ` / \u7F13\u5B58\u8BFB ${tokenCount(detail.usage.cachedReadTokens)}` : "",
              detail.usage.cachedWriteTokens != null ? ` / \u7F13\u5B58\u5199 ${tokenCount(detail.usage.cachedWriteTokens)}` : "",
              "\uFF09"
            ] })
          ] }),
          detail.contextUsage && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u4E0A\u4E0B\u6587\u5360\u7528 ",
            tokenCount(detail.contextUsage.used),
            " / ",
            tokenCount(detail.contextUsage.size)
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u521B\u5EFA\u4E8E ",
            time(detail.createdAt)
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u7ED3\u675F\u4E8E ",
            time(detail.endedAt)
          ] }),
          detail.retryOf && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u91CD\u8BD5\u81EA ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: detail.retryOf })
          ] })
        ] }),
        resumable(detail) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dd-subtle", children: "\u8D85\u65F6\u6216\u4E2D\u65AD\u7684\u4EFB\u52A1\u53EF\u4EE5\u201C\u7EE7\u7EED\u8FD0\u884C\u201D\uFF0C\u5728\u539F\u4F1A\u8BDD\u4E2D\u63A5\u7740\u6267\u884C\uFF1B\u91CD\u8BD5\u4F1A\u5F00\u542F\u5168\u65B0\u4F1A\u8BDD\u3002" }),
        retryable(detail) && !resumable(detail) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dd-subtle", children: "\u5931\u8D25\u6216\u4E2D\u65AD\u7684\u4EFB\u52A1\u53EF\u4EE5\u624B\u52A8\u91CD\u8BD5\uFF1B\u91CD\u8BD5\u4F1A\u6CBF\u7528\u672C\u6B21\u6267\u884C\u7684\u63D0\u793A\u3001\u76EE\u5F55\u3001\u6A21\u578B\u3001\u601D\u8003\u5F3A\u5EA6\u548C\u6743\u9650\uFF0C\u4F46\u4F1A\u5F00\u542F\u65B0\u7684\u4F1A\u8BDD\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u91CD\u8BD5\u3002" }),
        state.tasks.some((t) => t.retryOf === detail.id) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "dd-subtle", children: [
          "\u91CD\u8BD5\u8BB0\u5F55\uFF1A",
          state.tasks.filter((t) => t.retryOf === detail.id).map((t) => `${t.id}\uFF08${statuses[t.status] || t.status}\uFF09`).join("\u3001")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "\u56DE\u7B54" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: "dd-answer", children: detail.answer || (active(detail) ? "DeepSeek \u6B63\u5728\u5904\u7406\u4EFB\u52A1\uFF0C\u7ED3\u679C\u4F1A\u81EA\u52A8\u66F4\u65B0\u3002" : detail.partialAnswer || "\u6CA1\u6709\u6700\u7EC8\u56DE\u7B54\u3002") }),
        !detail.answer && detail.partialAnswer && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dd-subtle", children: "\u672A\u5B8C\u6210\uFF1A\u8FD9\u662F\u8D85\u65F6/\u4E2D\u65AD\u524D\u6700\u540E\u4E00\u6BB5\u8F93\u51FA\uFF0C\u4E0D\u662F\u6700\u7EC8\u7B54\u6848\u3002" }),
        detail.error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: "dd-error", role: "alert", children: detail.error }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", { children: [
            "\u6267\u884C\u65E5\u5FD7 \xB7 ",
            detail.events.length,
            " \u6761"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-events", children: [
            detail.events.map((event, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: new Date(event.at).toLocaleTimeString("zh-CN") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: event.type }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { children: event.text })
            ] }, i)),
            detail.stderr && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { children: detail.stderr })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dd-ids", children: [
          "\u4EFB\u52A1 ",
          detail.id,
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
          "\u4F1A\u8BDD ",
          detail.sessionId || "\u5C1A\u672A\u5EFA\u7ACB"
        ] })
      ] }) })
    ] })
  ] });
}
var inject = ["slots", "layout", "connection"];
function apply(ctx) {
  const api = createPanelApi(() => ctx.connection);
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent = ".dd-root{--dd-ink:var(--text-primary,#e5e7eb);--dd-muted:var(--text-secondary,#9299a7);--dd-bg:var(--bg-primary,#17191e);--dd-panel:var(--bg-secondary,#1f2229);--dd-line:rgba(140,150,170,.2);--dd-accent:#7c9cff;color:var(--dd-ink);background:var(--dd-bg);height:100%;min-height:0;display:flex;flex-direction:column;font:14px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif;overflow:auto;color-scheme:dark}\n.dd-root *{box-sizing:border-box}.dd-root button,.dd-root input,.dd-root textarea,.dd-root select{font:inherit;color:inherit}.dd-root button{border:1px solid var(--dd-line);background:transparent;border-radius:8px;padding:7px 13px;cursor:pointer;transition:background .15s}.dd-root button:hover{background:rgba(140,150,170,.1)}.dd-root button:disabled{opacity:.45;cursor:default}.dd-root :focus-visible{outline:2px solid var(--dd-accent);outline-offset:3px}.dd-root h1,.dd-root h2,.dd-root h3,.dd-root p{margin:0}.dd-root h1{font-size:20px;font-weight:650;letter-spacing:-.5px}.dd-root h2{font-size:22px;letter-spacing:-.5px;font-weight:620}.dd-root h3{font-size:14px;margin:26px 0 12px;font-weight:650}.dd-root small,.dd-root .dd-subtle{color:var(--dd-muted);font-size:12px}.dd-root code{font:12px/1.7 Consolas,monospace;overflow-wrap:anywhere}.dd-root pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.8 system-ui,sans-serif;margin:0}.dd-header{padding:26px 32px 23px;display:flex;align-items:center;justify-content:space-between;gap:20px}.dd-heading{display:flex;gap:14px;align-items:center}.dd-heading p{font-size:12px;color:var(--dd-muted);margin-top:3px}.dd-logo{width:44px;height:44px;display:grid;place-items:center;background:rgba(124,156,255,.12);border:1px solid rgba(124,156,255,.2);color:var(--dd-accent);border-radius:13px}.dd-connection{display:flex;align-items:center;gap:7px;color:var(--dd-muted);font-size:12px;white-space:nowrap}.dd-connection i,.dd-badge i{width:6px;height:6px;border-radius:50%;background:currentColor}.dd-online{color:#70c5a8}.dd-nav{display:flex;align-items:center;gap:18px;padding:0 32px;border-bottom:1px solid var(--dd-line)}.dd-nav>span{flex:1}.dd-nav button{border:0;border-radius:0;padding:11px 2px 13px;color:var(--dd-muted);font-size:13px;border-bottom:2px solid transparent}.dd-nav button[aria-current]{color:var(--dd-accent);border-bottom-color:var(--dd-accent)}.dd-nav button:last-child{font-size:12px}.dd-workspace{flex:1;min-height:300px;display:grid;grid-template-columns:245px minmax(0,1fr)}.dd-tasklist{border-right:1px solid var(--dd-line);overflow-y:auto;max-height:calc(100vh - 155px);padding:16px 10px}.dd-list-head{display:flex;justify-content:space-between;align-items:center;padding:0 4px 14px;font-size:12px;color:var(--dd-muted)}.dd-list-head b{font-weight:400;opacity:.7;margin-left:4px}.dd-list-head button{font-size:12px;padding:4px 7px}.dd-root .dd-task{display:block;width:100%;text-align:left;border:1px solid transparent;padding:13px 12px;margin:3px 0 7px;border-radius:9px}.dd-task>div{display:flex;align-items:center;justify-content:space-between;gap:8px}.dd-task strong{font-size:13px;font-weight:550;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:9px 0 5px;overflow-wrap:anywhere}.dd-task p{color:var(--dd-muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dd-root .dd-task.dd-selected{background:rgba(124,156,255,.09);border-color:rgba(124,156,255,.22)}.dd-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--dd-muted)}.dd-running{color:#a0b6ff}.dd-queued{color:#cfb574}.dd-completed{color:#70c5a8}.dd-failed{color:#ef969b}.dd-running i{animation:dd-pulse 1.6s ease-in-out infinite}.dd-content{overflow-y:auto;max-height:calc(100vh - 155px)}.dd-compose,.dd-detail{max-width:850px;margin:0 auto;padding:32px 35px 40px}.dd-section-head{margin-bottom:27px}.dd-section-head p{color:var(--dd-muted);font-size:13px;margin-top:7px}.dd-eyebrow{display:block;color:var(--dd-accent);font-size:11px;letter-spacing:1px;margin-bottom:12px}.dd-field{display:flex;flex-direction:column;gap:8px;margin-bottom:22px}.dd-field>span{font-size:12px;font-weight:550}.dd-field input,.dd-field textarea,.dd-field select{width:100%;border:1px solid var(--dd-line);border-radius:8px;background:rgba(100,110,130,.045);padding:10px 12px;outline:none}.dd-field input:focus,.dd-field textarea:focus,.dd-field select:focus{border-color:var(--dd-accent)}.dd-field textarea{resize:vertical;min-height:160px;line-height:1.8}.dd-field input::placeholder,.dd-field textarea::placeholder{color:var(--dd-muted);opacity:.65}.dd-field select option{background:var(--dd-panel)}.dd-field small{line-height:1.6}.dd-compose-footer{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-top:27px}.dd-compose-footer>div{display:flex;flex-direction:column;gap:5px}.dd-compose-footer code{color:var(--dd-muted)}.dd-root button.dd-primary{background:var(--dd-accent);border-color:var(--dd-accent);color:#11192e;font-weight:650;padding:9px 17px}.dd-root button.dd-primary:hover{filter:brightness(1.06)}.dd-settings{width:100%;max-width:850px;padding:32px 35px 45px;margin:0 auto}.dd-settings>.dd-subtle{margin-top:22px;overflow-wrap:anywhere}.dd-grid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px}.dd-check{display:flex;align-items:center;gap:9px;margin:16px 0;font-size:13px}.dd-check input{accent-color:var(--dd-accent)}.dd-alert,.dd-notice{margin:15px 32px 0;border:1px solid rgba(239,150,155,.25);background:rgba(239,150,155,.07);border-radius:8px;padding:10px 14px;color:#ef969b;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}.dd-notice{color:#70c5a8;border-color:rgba(112,197,168,.25);background:rgba(112,197,168,.07)}.dd-root .dd-error{background:rgba(239,150,155,.06);border:1px solid rgba(239,150,155,.2);padding:15px;border-radius:8px;margin:18px 0;color:#ef969b;font-size:12px}.dd-loading,.dd-empty-list{padding:30px;color:var(--dd-muted);font-size:13px}.dd-empty-list{padding:24px 10px;line-height:2}.dd-detail-head{display:flex;gap:12px;align-items:center;margin-bottom:22px}.dd-detail-head>span:nth-child(2){flex:1}.dd-root .dd-prompt{margin:15px 0 22px;padding:16px;background:rgba(140,150,170,.06);border:1px solid var(--dd-line);border-radius:9px}.dd-metadata{display:flex;flex-direction:column;gap:6px;font-size:11px;color:var(--dd-muted)}.dd-metadata code{font-size:11px;margin-left:6px}.dd-answer{min-height:60px}.dd-detail details{border-top:1px solid var(--dd-line);margin-top:28px;padding-top:16px}.dd-detail summary{cursor:pointer;color:var(--dd-muted);font-size:12px}.dd-events{margin-top:14px;max-height:350px;overflow:auto}.dd-events>div{padding:8px 0;border-bottom:1px solid var(--dd-line)}.dd-events code{margin-left:10px;color:var(--dd-accent)}.dd-events pre{font-size:12px;color:var(--dd-muted);padding-top:5px}.dd-ids{margin-top:24px;font:10px/2 Consolas,monospace;color:var(--dd-muted);overflow-wrap:anywhere}.dd-parent{display:flex;gap:15px;align-items:center;border:1px solid var(--dd-line);border-radius:8px;padding:10px 12px;font-size:12px;margin-bottom:22px}.dd-parent span{flex:1}.dd-parent button{white-space:nowrap;font-size:11px}.dd-code-head{display:flex;justify-content:space-between;align-items:center;margin:25px 0 12px;gap:12px}.dd-switch{display:flex;gap:4px}.dd-switch button{font-size:12px}.dd-switch button[aria-pressed=true]{color:var(--dd-accent);border-color:rgba(124,156,255,.4);background:rgba(124,156,255,.08)}.dd-code-head>button{font-size:12px}.dd-root .dd-code{font:12px/1.9 Consolas,monospace;background:rgba(140,150,170,.065);padding:18px;border:1px solid var(--dd-line);border-radius:9px;user-select:text}.dd-steps{color:var(--dd-muted);padding-left:22px;font-size:13px;line-height:2.3}.dd-tools>div{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--dd-line)}.dd-tools span{color:var(--dd-muted);font-size:12px}\n@keyframes dd-pulse{50%{opacity:.3}}\n@media(max-width:850px){.dd-header{padding:22px}.dd-nav{padding:0 22px}.dd-workspace{grid-template-columns:195px minmax(0,1fr)}.dd-compose,.dd-detail,.dd-settings{padding:25px 22px}.dd-grid{grid-template-columns:1fr}.dd-connection{font-size:11px}.dd-heading p{display:none}.dd-compose-footer{align-items:stretch;flex-direction:column}.dd-compose-footer>button{align-self:flex-end}}\n@media(prefers-reduced-motion:reduce){.dd-running i{animation:none}}\n.dd-root .dd-retry{border-color:rgba(124,156,255,.45);color:var(--dd-accent)}\n.dd-root .dd-retry:hover{background:rgba(124,156,255,.12)}\n.dd-metadata b{font-weight:650;color:var(--dd-ink)}\n.dd-task-usage,.dd-usage-summary{color:var(--dd-muted);font-size:11px}\n.dd-task-filter{display:flex;align-items:center;gap:8px;margin:0 4px 12px;color:var(--dd-muted);font-size:12px}.dd-task-filter select{min-width:0;flex:1;background:var(--dd-panel);border:1px solid var(--dd-line);border-radius:6px;padding:5px}.dd-pagination{display:flex;align-items:center;justify-content:space-between;gap:6px;margin:16px 4px 4px;font-size:11px;color:var(--dd-muted)}.dd-pagination button{padding:5px 7px;font-size:11px}\n.dd-root .dd-resume{border:1px solid var(--dd-line);border-radius:10px;padding:20px 22px;margin:18px 0 24px;background:rgba(124,156,255,.04)}\n.dd-root .dd-resume textarea{min-height:110px}\n";
    document.head.append(style);
    return () => style.remove();
  }, "deepseek-delegate: styles");
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: PANEL, inject: () => ({ api }) }, Page));
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: PANEL, order: 20, label: "DeepSeek \u59D4\u6D3E" }, Icon));
}
return module.exports;}});
