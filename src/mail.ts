import Imap from "imap";

const imap = new Imap({
  user: "matheusdomingues423@gmail.com",
  password: "vblrukjinvstkoyf",
  host: "imap.gmail.com",
  port: 993,
  tls: true,
  tlsOptions: { rejectUnauthorized: false },
});

function openInbox(cb: (err: Error | null, box?: Imap.Box) => void) {
  imap.openBox("INBOX", true, cb);
}

imap.once("ready", () => {
  openInbox((err, box) => {
    if (err) throw err;
    console.log(`Total messages: ${box?.messages.total}`);

    // Fetch the last 5 emails
    const fetch = imap.seq.fetch(`${Math.max(1, (box?.messages.total ?? 5) - 4)}:*`, {
      bodies: ["HEADER.FIELDS (FROM SUBJECT DATE)"],
    });

    fetch.on("message", (msg) => {
      msg.on("body", (stream) => {
        let buffer = "";
        stream.on("data", (chunk) => (buffer += chunk.toString()));
        stream.on("end", () => console.log(buffer));
      });
    });

    fetch.once("end", () => {
      console.log("Done fetching emails.");
      imap.end();
    });
  });
});

imap.once("error", (err: Error) => console.error(err));
imap.once("end", () => console.log("Connection ended."));

imap.connect();
