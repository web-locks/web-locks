import {
  ArrowRight,
  Check,
  Copy,
  Crown,
  ExternalLink,
  Code,
  Lock,
  Package,
  PlugZap,
  Radio,
  ShieldCheck,
  createIcons,
} from "lucide";
import "./style.css";

createIcons({
  icons: {
    ArrowRight,
    Check,
    Copy,
    Crown,
    ExternalLink,
    Code,
    Lock,
    Package,
    PlugZap,
    Radio,
    ShieldCheck,
  },
});

for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-copy]")) {
  const label = button.querySelector<HTMLElement>("[data-label]");
  const status = button.closest("[data-copy-group]")?.querySelector<HTMLElement>("[data-status]");
  let timer: ReturnType<typeof setTimeout> | undefined;

  const report = (message: string, text: string) => {
    if (status) status.textContent = message;
    if (label) label.textContent = text;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (status) status.textContent = "";
      if (label) label.textContent = "Copy";
    }, 2000);
  };

  button.addEventListener("click", async () => {
    const text = button.dataset.copy ?? "";
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      report("Copied to clipboard", "Copied");
    } catch {
      report("Copy is not available here. Select the command and copy it manually.", "Copy");
    }
  });
}
