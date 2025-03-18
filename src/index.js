const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fetch = require("node-fetch").default;
const path = require("node:path");
const { exec } = require("child_process");
const webAppUrl = process.env.WEB_APP_URL;
const webAppCustomCss = process.env.WEB_APP_CUSTOM_CSS;

// Helper function to execute shell commands
const sh = (cmd) => {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(`Error: ${error.message}\n${stderr}`);
        return;
      }

      if (stderr) {
        reject(`Stderr: ${stderr}`);
        return;
      }

      resolve(stdout.trim());
    });
  });
};

// Create the main application window
const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    titleBarStyle: "hidden",
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });

  mainWindow.loadURL(webAppUrl);

  // Open external links in the browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Handle window focus requests from the renderer
  ipcMain.on("window-focus-requested", (_) => {
    const originalTitle = mainWindow.getTitle();
    const tempTitle = Date.now().toString();
    mainWindow.setTitle(tempTitle);

    (async () => {
      const windowData = (await sh("niri msg windows"))
        .split("\n\n")
        .find((w) => w.includes(`Title: "${tempTitle}"`));

      const windowId = (windowData.match(/Window ID (\d+):/) || [])[1];

      await sh(`niri msg action focus-window --id ${windowId}`);
    })()
      .catch((err) => console.log(err))
      .finally(() => {
        mainWindow.setTitle(originalTitle);
      });
  });

  // Modify notification behavior on the renderer side
  mainWindow.webContents.on("did-finish-load", async () => {
    mainWindow.webContents.session.setSpellCheckerEnabled(false);

    const cssContent = webAppCustomCss
      ? await fetch(webAppCustomCss)
          .then((res) => res.text())
          .catch(() => "")
      : "";

    mainWindow.webContents.executeJavaScript(`
      const OriginalNotification = window.Notification;

      const NewNotification = function(title, opt) {
        const notification = new OriginalNotification(title, opt);
        
        notification.addEventListener('click', () => {
          window.webAppBridge.requestWindowFocus();
        });
        
        return notification;
      };

      NewNotification.requestPermission = OriginalNotification.requestPermission.bind(OriginalNotification);

      Object.defineProperty(NewNotification, 'permission', {
        get: () => OriginalNotification.permission
      });

      window.Notification = NewNotification;
      window.focus = () =>  window.webAppBridge.requestWindowFocus();

      const style = document.createElement('style');
      style.textContent = \`${cssContent}\`;
      document.head.appendChild(style);
    `);
  });
};

// Initialize the application when ready
app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit the application when all windows are closed, except on macOS
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
