import type { ComponentType } from "react";
import {
  PencilIcon, SparkleFillIcon, SearchIcon, LinkIcon, PlugIcon,
  PaperAirplaneIcon, MailIcon, FileIcon, GitBranchIcon, SignInIcon, SignOutIcon,
} from "@primer/octicons-react";

// The full node palette, settled 2026-09-02 after checking real naming
// conventions across n8n/Zapier/Make.com (see conversation — Zapier
// brands its generic-API node "Webhooks by Zapier", Make.com literally
// labels it "Make an API call"; branching is Zapier's "Paths"). Every
// label here is plain, verb-first, no protocol jargon — a marketer
// should be able to read this list and know what each node does.
//
// Two kinds are genuinely deterministic (writeText, sendMessage's
// eventual backend, sendMail, saveFile, apiCall all just dispatch code
// once they have their input — see dispatcher/agent_work.py's node-
// function library, which this palette is the visual front end for);
// generateAi/searchWeb/readPage/choosePath genuinely need a model call.
// This file is visual/definitional only — "just make the nodes, later
// we do the backend" (2026-09-02) — `fields` describes what the right-
// sidebar editor should show, it doesn't wire anything to NAVI yet.

export type NodeKindId =
  | "writeText" | "generateAi" | "searchWeb" | "readPage"
  | "apiCall" | "sendMessage" | "sendMail" | "saveFile" | "choosePath"
  | "input" | "output";

export type FieldKind = "text" | "textarea" | "select" | "url";

export interface NodeFieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export interface NodeKindDef {
  id: NodeKindId;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number; fill?: string }>;
  hue: number; // distinct accent per kind, for at-a-glance scanning on a canvas with many nodes
  fields: NodeFieldDef[];
}

export const NODE_KINDS: Record<NodeKindId, NodeKindDef> = {
  writeText: {
    id: "writeText", label: "Write Text",
    description: "A fixed piece of text you already know — no AI involved, sent or saved exactly as written.",
    icon: PencilIcon, hue: 60,
    fields: [{ key: "text", label: "Text", kind: "textarea", placeholder: "Type the exact text..." }],
  },
  generateAi: {
    id: "generateAi", label: "Generate with AI",
    description: "Have AI write the text for this step, based on your instructions and anything earlier steps found.",
    icon: SparkleFillIcon, hue: 280,
    fields: [{ key: "instructions", label: "Instructions", kind: "textarea", placeholder: "What should the AI write?" }],
  },
  searchWeb: {
    id: "searchWeb", label: "Search the Web",
    description: "Look something up online.",
    icon: SearchIcon, hue: 145,
    fields: [{ key: "instructions", label: "What to search for", kind: "textarea", placeholder: "e.g. today's top tech news" }],
  },
  readPage: {
    id: "readPage", label: "Read a Web Page",
    description: "Fetch and read one specific page.",
    icon: LinkIcon, hue: 195,
    fields: [{ key: "url", label: "Page URL", kind: "url", placeholder: "https://..." }],
  },
  apiCall: {
    id: "apiCall", label: "Make an API Call",
    description: "Talk directly to any service that has an API — for anything not covered by a dedicated node.",
    icon: PlugIcon, hue: 25,
    fields: [
      { key: "url", label: "URL", kind: "url", placeholder: "https://api.example.com/..." },
      { key: "method", label: "Method", kind: "select", options: [
        { value: "GET", label: "GET" }, { value: "POST", label: "POST" },
        { value: "PUT", label: "PUT" }, { value: "PATCH", label: "PATCH" }, { value: "DELETE", label: "DELETE" },
      ] },
      { key: "body", label: "Body (optional)", kind: "textarea", placeholder: "Request body, if any" },
    ],
  },
  sendMessage: {
    id: "sendMessage", label: "Send Message To",
    description: "Send a chat message — Telegram, Discord, and more as they're added.",
    icon: PaperAirplaneIcon, hue: 205,
    fields: [
      { key: "channel", label: "Channel", kind: "select", options: [
        { value: "telegram", label: "Telegram" },
        { value: "discord", label: "Discord" },
      ] },
    ],
  },
  sendMail: {
    id: "sendMail", label: "Send Mail To",
    description: "Send an email — its own node since email needs a subject line, unlike chat messages.",
    icon: MailIcon, hue: 350,
    fields: [
      { key: "to", label: "To", kind: "text", placeholder: "recipient@example.com" },
      { key: "subject", label: "Subject", kind: "text" },
    ],
  },
  saveFile: {
    id: "saveFile", label: "Save a File",
    description: "Save the step's content to persistent storage.",
    icon: FileIcon, hue: 40,
    fields: [{ key: "filename", label: "Filename (optional)", kind: "text", placeholder: "auto-named if left blank" }],
  },
  choosePath: {
    id: "choosePath", label: "Choose a Path",
    description: "Branch — only the path matching your condition runs, the rest are skipped.",
    icon: GitBranchIcon, hue: 15,
    fields: [{ key: "condition", label: "Condition", kind: "textarea", placeholder: "e.g. if the news is about AI" }],
  },
  // Input/output (2026-09-03) — formalizes what a fan-out group's
  // {{item}} already does informally (dispatcher/agent_work.py's own
  // node function docstrings), generalized to the whole workflow.
  // Deterministic, always — JuanJo's explicit call: "whatever
  // instruction has the Input and Output nodes, are deterministic,
  // unless they want an LLM input node" (that variant isn't built; this
  // is the plain default). No AI involved in either direction.
  input: {
    id: "input", label: "Input",
    description: "Marks where external data enters this workflow — no AI involved, the value is used exactly as set.",
    icon: SignInIcon, hue: 100,
    fields: [{ key: "value", label: "Value", kind: "textarea", placeholder: "The literal value this workflow starts with" }],
  },
  output: {
    id: "output", label: "Output",
    description: "Returns whatever the connected step produced — for an agent used as a step inside another workflow, not a real-world action like sending a message.",
    icon: SignOutIcon, hue: 330,
    fields: [
      { key: "value", label: "Fallback value (optional)", kind: "textarea", placeholder: "Used only if nothing upstream produced anything" },
      // Same output_type vocabulary as Agent Vault's saved agents
      // (storage/agents.py) — "pdf" renders the incoming text to a
      // real PDF file (2026-09-03: "create an output node before
      // sending to telegram with pdf as output, we already have
      // that"); a following Send Message To step recognizes and sends
      // it as an attachment instead of stuffing a file path into a
      // chat message. "chat"/blank stays plain text, unchanged.
      { key: "outputType", label: "Format", kind: "select", options: [
        { value: "chat", label: "Text" },
        { value: "pdf", label: "PDF file" },
        { value: "markdown", label: "Markdown" },
      ] },
    ],
  },
};

export const NODE_KIND_LIST: NodeKindDef[] = Object.values(NODE_KINDS);
