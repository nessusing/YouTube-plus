// Small corner notice when syncing keeps failing (design §26). Clicking it
// opens the settings page with the log filtered to `queue`.

export interface StatusBadge {
  show(text: string): void;
  hide(): void;
}

export function statusBadge(): StatusBadge {
  let host: HTMLElement | undefined;
  let button: HTMLButtonElement | undefined;

  return {
    show(text: string) {
      if (!host) {
        host = document.createElement('ytpp-queue-status');
        host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2040;';
        const root = host.attachShadow({ mode: 'closed' });
        root.innerHTML = `<style>
          button { all: unset; cursor: pointer; font: 13px/1.4 Roboto, Arial, sans-serif; color: #fff;
            background: #c5221f; padding: 8px 14px; border-radius: 18px; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
          button:hover { background: #a50e0e; }
          button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
        </style><button type="button"></button>`;
        button = root.querySelector('button')!;
        button.addEventListener('click', () => {
          void browser.runtime.sendMessage({ type: 'YouTube+/open-options', hash: 'log=queue' });
        });
        document.documentElement.append(host);
      }
      button!.textContent = text;
    },
    hide() {
      host?.remove();
      host = button = undefined;
    },
  };
}
