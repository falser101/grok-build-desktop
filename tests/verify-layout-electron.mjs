/**
 * Electron renderer layout verifier — launches the app and checks computed
 * CSS of the .history-timeline-rail and .chat-rail elements programmatically.
 *
 * Since we can't take screenshots in a headless X11 environment, this drives
 * the real shipped code and asserts the DOM's computed style values.
 *
 * Usage: node --require=ts-node/register tests/verify-layout-electron.mjs
 * or:    npx tsx tests/verify-layout-electron.mjs
 */
const { app, BrowserWindow } = require("electron");
const path = require("path");

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error("  FAIL:", msg); failures++; }
  else { console.log("  PASS:", msg); }
}

// Register a custom protocol to serve the built renderer
app.commandLine.appendSwitch("no-sandbox");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // don't need visual display
    webPreferences: {
      preload: path.join(__dirname, "..", "out", "preload", "index.mjs"),
      sandbox: false,
    },
  });

  const indexPath = path.join(__dirname, "..", "out", "renderer", "index.html");

  try {
    await win.loadFile(indexPath);
    console.log("Window loaded, waiting for render...");
    // Wait for React to mount
    await new Promise((r) => setTimeout(r, 2000));

    // Evaluate layout in the renderer
    const result = await win.webContents.executeJavaScript(`
      (() => {
        const mainChat = document.querySelector('.main-chat');
        const rail = document.querySelector('.history-timeline-rail');
        const chatRail = document.querySelector('.chat-rail');
        const mainWork = document.querySelector('.main-work');
        const chatPane = document.querySelector('.main-scroll.chat-pane');
        const userMsg = document.querySelector('.msg.msg-user');

        if (!mainChat) return { error: '.main-chat not found' };
        if (!chatRail) return { error: '.chat-rail not found' };
        if (!mainWork) return { error: '.main-work not found' };
        if (!chatPane) return { error: '.main-scroll.chat-pane not found' };

        const mcStyle = getComputedStyle(mainChat);
        const crStyle = getComputedStyle(chatRail);
        const mwStyle = getComputedStyle(mainWork);
        const cpStyle = getComputedStyle(chatPane);

        return {
          // .main-chat
          mainChat_position: mcStyle.position,
          mainChat_display: mcStyle.display,
          mainChat_flexDirection: mcStyle.flexDirection,
          mainChat_height: mcStyle.height,
          mainChat_width: mcStyle.width,

          // .chat-rail
          chatRail_maxWidth: crStyle.maxWidth,
          chatRail_marginLeft: crStyle.marginLeft,
          chatRail_marginRight: crStyle.marginRight,
          chatRail_width: crStyle.width,
          chatRail_flexGrow: crStyle.flexGrow,

          // .main-work
          mainWork_flex: mwStyle.flex,
          mainWork_display: mwStyle.display,
          mainWork_gridTemplateRows: mwStyle.gridTemplateRows,
          mainWork_height: mwStyle.height,

          // .chat-pane
          chatPane_paddingTop: cpStyle.paddingTop,
          chatPane_overflowY: cpStyle.overflowY,

          // rail existence
          rail_exists: !!rail,
          rail_position: rail ? getComputedStyle(rail).position : 'n/a',
          rail_left: rail ? getComputedStyle(rail).left : 'n/a',

          // user message sticky
          userMsg_exists: !!userMsg,
          userMsg_position: userMsg ? getComputedStyle(userMsg).position : 'n/a',
          userMsg_top: userMsg ? getComputedStyle(userMsg).top : 'n/a',
        };
      })()
    `);

    console.log(JSON.stringify(result, null, 2));

    // Verify the results
    console.log("\nCriterion 1: Rail at left edge");
    assert(result.rail_exists, "rail exists in DOM");
    assert(result.rail_position === "absolute", `rail position=absolute (got ${result.rail_position})`);
    assert(parseInt(result.rail_left) <= 2, `rail left ≤ 2px (got ${result.rail_left})`);

    console.log("\nCriterion 2: Chat rail centered");
    assert(result.chatRail_marginLeft === result.chatRail_marginRight,
      `chat-rail margins equal (left=${result.chatRail_marginLeft}, right=${result.chatRail_marginRight})`);
    assert(result.chatRail_maxWidth !== "none" && result.chatRail_maxWidth !== "",
      `chat-rail has max-width (got ${result.chatRail_maxWidth})`);

    console.log("\nCriterion 3: Content fills height");
    assert(result.mainWork_display === "grid", `main-work display=grid (got ${result.mainWork_display})`);
    assert(result.mainWork_gridTemplateRows.includes("1fr") || result.mainWork_gridTemplateRows.includes("minmax"),
      `main-work grid-template-rows fills (got ${result.mainWork_gridTemplateRows})`);
    assert(parseFloat(result.mainWork_height) > 100,
      `main-work height > 100px (got ${result.mainWork_height})`);

    console.log("\nCriterion 4: Sticky alignment");
    if (result.userMsg_exists) {
      assert(result.userMsg_position === "sticky" || result.userMsg_position === "-webkit-sticky",
        `user msg position=sticky (got ${result.userMsg_position})`);
      assert(parseInt(result.userMsg_top) === 24,
        `user msg top=24px (got ${result.userMsg_top})`);
    } else {
      console.log("  SKIP: no user message in DOM (empty session)");
    }

    console.log(`\n${"=".repeat(50)}`);
    if (failures === 0) {
      console.log("ALL LAYOUT VERIFICATIONS PASSED");
    } else {
      console.log(`${failures} VERIFICATION(S) FAILED`);
    }
  } catch (err) {
    console.error("Evaluation error:", err.message);
    failures++;
  } finally {
    win.close();
    app.quit();
  }
});
