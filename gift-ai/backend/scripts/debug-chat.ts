import { chatEngine } from "../src/modules/chat-engine.js";

async function main() {
  await chatEngine.start("telegram", "debug2");
  try {
    const m = await chatEngine.handleMessage({
      channel: "telegram",
      channelUserId: "debug2",
      text: "я хочу сделать подарок своему папе",
    });
    console.log("OK:", m.reply);
  } catch (e) {
    console.error("FAIL:", e);
  }
}

main();
