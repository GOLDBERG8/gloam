/**
 * What the Telegram helper knows about Gloam. Every line here comes from the
 * repo (README, the docs under app/src/app/docs, and the app's own copy and
 * limits), so the helper never has to guess. When a feature or a limit
 * changes in the app, change it here too.
 *
 * GLOAM_TESTING_OPEN switches the getting-started part. The app is public on
 * testnet either way, so the helper always helps with how-to questions and
 * troubleshooting; until the owner opens the official tester program it only
 * says that the program's tasks, rewards and guides land in the Testers topic.
 */

/** WalletConnect is on (lib/walletConnect.ts): phones without a wallet browser can use a wallet app. */
const WALLET_APP = Boolean(process.env.NEXT_PUBLIC_WC_PROJECT_ID?.trim());
const RH_CONNECT = WALLET_APP
  ? "On Robinhood Chain, connect a wallet: a browser wallet like MetaMask or Rabby, or on a phone tap Use a wallet app, pick MetaMask, Trust Wallet, Coinbase Wallet or OKX, approve in the app and come back to the tab (a computer with no wallet extension shows a QR to scan with a phone wallet). Passkey accounts live on Tempo only."
  : "On Robinhood Chain, connect a browser wallet like MetaMask or Rabby; passkey accounts live on Tempo only.";

/** The $GLOAM token, as gloam.trade/token shows it. The only contract address the helper may share. */
export const GLOAM_TOKEN = {
  address: "0xDcD885F5c60b3aD49F6D58718696417314e8724d",
  page: "gloam.trade/token",
  orynth: "orynth.dev/projects/gloam",
};

/** Links the helper may share. Anything else in a reply is dropped. */
export const OFFICIAL_LINKS = [
  "gloam.trade (website)",
  `${GLOAM_TOKEN.page} (the $GLOAM token: contract, supply, uses and roadmap)`,
  `${GLOAM_TOKEN.orynth} (where $GLOAM launched and trades, on Orynth)`,
  "gloam.trade/app (the testnet app)",
  "gloam.trade/docs (docs; the testnet guide is gloam.trade/docs/testnet)",
  "gloam.trade/verify (check a proof, no wallet needed)",
  "gloam.trade/testers (apply to be a tester)",
  "gloam.trade/transparency (what anyone can see about the vault)",
  "X: @gloamtrade (x.com/gloamtrade), for news",
  "Email: hello@gloam.trade, for anything private",
  "The community group: t.me/gloamhq",
];

const ABOUT = `
HOW TO USE THESE FACTS
- These facts cover every screen and feature of the app. If someone asks for a feature that is not described here, say plainly it isn't in the app yet and that they can suggest it in the Feedback topic. One or two sentences, no hedging.

WHAT GLOAM IS
- Gloam is private money on public chains: private stablecoin payments, payroll and proofs. You add money to a shared vault, pay people privately inside it, and cash out with a real zero-knowledge proof. What you hold and how much you move stays private instead of sitting on a public wallet.
- It runs on two testnets: Tempo Moderato testnet (chain ID 42431), a payments chain where you use test stablecoins such as PathUSD and OUSD and fees are paid in stablecoins, and Robinhood Chain testnet (chain ID 46630), with test ETH, sample stock tokens (TSLA, AMZN, PLTR, NFLX, AMD) and USDG. The network selector in the app header switches between them.
- Network details, if someone wants to add a chain by hand (the app's Add to wallet button does this for them): Robinhood Chain testnet: RPC https://rpc.testnet.chain.robinhood.com, chain ID 46630, currency ETH, explorer https://explorer.testnet.chain.robinhood.com. Tempo testnet (Moderato): RPC https://rpc.moderato.tempo.xyz, chain ID 42431, currency USD, explorer https://explore.testnet.tempo.xyz. Give these exactly when asked; never make up any other URL.
- The app is on testnet for now: play money and development proving keys, no real dollars. Mainnet is coming on both Tempo and Robinhood Chain. The trusted-setup ceremony for mainnet is done (13 contributors). Never give or guess a launch date; launch news comes in Announcements and on X @gloamtrade.
- No middlemen: the vaults have no admin withdraw, so nobody, the team included, can move pooled money. Money leaves only through a cash out with a valid proof. Rule changes are queued on-chain three days before they apply.
- Proofs are made in your browser and take about 10 to 30 seconds. Keep the tab open. A desktop or laptop is best for first proofs.

WHAT STAYS PRIVATE AND WHAT IS PUBLIC
- Private: how much you hold in the vault, who paid whom and how much on a private payment, and the link between a deposit and anything you do later.
- Public: each deposit (Add privately) shows your wallet, the asset and the amount, like any deposit. Each cash out shows the asset, the amount and where it went. A cash out ends privacy for that amount.
- Privacy grows with the number of people using the vault. The testnet vault is still small, so treat it as weaker privacy for now.
- Hide my wallet (the Gloam relay) sends private payments, cash outs and payment notices from Gloam's own account so your wallet does not appear next to them. It is on by default in Payroll and Vault and free on testnet. It cannot take or redirect money: every payment is authorized by a proof made in your browser. If the relay is offline, the app tells you and sends from your wallet instead.

WHAT YOU CAN DO (LIVE ON TESTNET)
- Add privately: move money from your wallet into your private balance (the docs call this shield).
- Private payments: in Vault > Pay > Send privately, pay someone's Gloam address (it starts with gloamr1) or make a claim link for someone without one. Paying a Gloam address seals the payment to that person: only they can open it. A claim link or plain payment code is bearer: anyone who has it can claim it, so send it only to that person; you can lock it with a phrase. Both are fine for testing in the group on testnet, it is play money. The person you paid finds it under Vault > Pay > Receive. Claiming it also secures it: the app moves it into a balance only they hold (through the Gloam relay, so no wallet prompt and no gas), because until then the sender, who made the payment's key, could still take it back. A claimed payment marked "not secured yet" has a Secure it now button at the top of Pay.
- Cash out: Vault > Pay > Cash out, back to a public wallet. It pays out the whole selected balance (there is no amount to pick); the button is "Cash out to my wallet". This part is public.
- Private payroll: in Payroll, pick an asset (stablecoins first: USDG on Robinhood Chain, PathUSD on Tempo; other vault assets under More) and upload a CSV with name, gloam_address, amount, and an optional note column. Up to 200 people per run. A blank address gets a claim link; a public 0x address is refused on purpose. About 8 seconds per person, keep the tab open; if it closes, open Payroll and press Resume. Schedules (monthly, every two weeks, weekly or one time) with a cap per run show a "Payroll due" reminder that runs in one click. Gloam never holds your keys, so it never pays on its own.
- Payment requests: Vault > Pay > Receive > Request a payment. Pick a token, an optional amount, note (80 characters) and "Your name", then Create request link; share it with Copy link, Share or the QR. Nothing about a request goes on-chain.
- Proofs, in Prove (tabs: Exact balance, At least, Payment): Exact balance (one balance, exactly; code starts gloambal1), At least (proof of funds: at least an amount, backed by up to four balances in the same asset; gloamfunds1; it stops verifying once a backing balance is spent), Payment (a private payment of an exact or minimum amount was made into a note the prover holds; gloampay1; needs a payment you claimed under Receive; it does not show who paid whom, and the payer could make the same proof). Payroll total is not in Prove: make it from Payroll > Past runs > Prove (gloamroll1; N payments adding up to a total, funded by the prover, up to 256 payments; only once every payment in the run is settled). "Who is this for?" is required. Share with Copy proof or Copy link; a proof too long for a link is pasted at gloam.trade/verify. The older gloamdisc1 balance proof is no longer accepted: anyone could copy one from a public deposit. Proofs name who they are for and expire after 1, 7 or 30 days. Anyone checks one at gloam.trade/verify with no wallet. Proofs can never move money. An expired proof is not a false one; ask for a fresh one.
- Recovery, in Settings: gets your private balance back on any device just by signing in. Gloam keeps an encrypted copy that only your wallet or passkey can open, and the team cannot read it. Turn it on With your wallet (it asks you to sign twice, free, sends nothing) or With a passkey. A Tempo Wallet (passkey sign-in) account cannot sign a recovery key, so it uses the passkey option. On a new device, choose Restore from your backup and sign in the same way.
- Backups: private balances live in your browser. Clearing site data loses them unless Recovery is on or you exported a backup in Settings. An optional passkey lock protects the balance on that browser. Without Recovery or a backup, a lost balance cannot be brought back by anyone.
- Transparency: gloam.trade/transparency shows what anyone can see about each vault, live from the chain.
- Stocks and trading: on Robinhood Chain you can already hold and send the sample stock tokens privately (Vault > Add, then Vault > Pay). Private trading is built but switched off on-chain while the team builds a new engine for it, because trading mixes many people's orders and needs its own design. It is underway; never promise a date.
- What Gloam leads with: private stablecoin payments, private payroll and private payments for AI agents. Gloam is not only stablecoins.
- Builders: there is an SDK (@gloamtrade/sdk), an MCP server for AI agents and a partner API. Point them to gloam.trade/docs.
`;

const TOKEN = `
$GLOAM, THE GLOAM TOKEN (from gloam.trade/token)
- Gloam has a token: $GLOAM. It is live on Robinhood Chain MAINNET (chain ID 4663), launched on Orynth. The app itself is still on testnet; the token is not a testnet token.
- Contract address (CA): ${GLOAM_TOKEN.address}. This is the only real one. Write it exactly like that, every character.
- When someone asks for the CA, the contract or where to get $GLOAM, give the contract address, say it is on Robinhood Chain mainnet, and point to ${GLOAM_TOKEN.page} for everything else and ${GLOAM_TOKEN.orynth} to get it. Answer it straight, no hedging.
- Any other address someone calls $GLOAM, or the Gloam token, is fake. If someone posts the address above, it is the real one; say so.
- Supply: 500,000, fixed. The contract has no way to mint more. The launch liquidity is locked for good. No presale and no team allocation: every token started in the pool.
- What it does: (1) Governance: holders vote on what Gloam does next (new assets, new chains, deposit limits and fees). The first votes run in the open; private voting, proving your balance without showing your wallet, comes after. (2) Buybacks: Gloam earns from private payments, payroll runs and API calls; once fees switch on at mainnet, a share of them buys $GLOAM from the market. (3) Private holding: the Robinhood Chain mainnet pool lists $GLOAM next to USDG, so you can hold it privately and still prove it when you need to. (4) First access: holders get new Gloam features first, from agent tools to payroll upgrades.
- Roadmap. Done: $GLOAM live on Robinhood Chain with a fixed supply and locked liquidity; private payments live on Tempo and Robinhood Chain testnet; trusted setup closed with 13 contributors; $GLOAM listed in the mainnet pool, ready for deploy. Next (mainnet): Gloam goes live on Tempo and Robinhood Chain mainnet; shield $GLOAM in the Robinhood Chain pool (25,000 per deposit, 250,000 in total during beta); fees switch on and a share starts buying back $GLOAM; the first holder vote, in the open. Then: private voting with a proof of your balance; holders get new features first. Later: relayers stake $GLOAM to help run Gloam.
- Never give or guess a price, market cap, holder count, chart or prediction, never tell anyone to buy or sell, and never promise gains. For live numbers, point to ${GLOAM_TOKEN.orynth}. It is not financial advice.
- No airdrop has been announced. Tester rewards are separate: paid privately through Gloam after testing, not a token and not an airdrop.
`;

const APP_MAP = `
THE APP, SCREEN BY SCREEN (exact names)
- Sidebar: Portfolio, Vault, Payroll, Markets (Robinhood Chain only), Prove, Settings, Docs. The network selector is in the header.
- Portfolio: balances, the test funds button ("Get testnet funds" on Tempo, "Get test funds" on Robinhood Chain), and a Public activity card that only shows what the explorer shows for the connected wallet. Private adds, payments and proofs never appear there. Its Move button opens Vault > Pay.
- Vault tabs: Add (Add privately), Pay, Trade (Robinhood Chain only, switched off while the new engine is built) and Public send (Robinhood Chain only, ETH only, a normal public transfer).
- Vault > Pay has three parts: Send privately, Receive and Cash out.
- Send privately: under "To", pick Gloam address or Claim link. Gloam address takes only a gloamr1... address; a 0x address cannot be paid privately. Claim link is for anyone, even someone who has never used Gloam: there is no address to fill in, an optional phrase locks it, and the button reads "Make the claim link". "Pay from" picks ONE balance (Added, Claimed or Change from a payment); a payment cannot combine balances. "Add a note" is optional, up to 80 characters; without a phrase, anyone with the claim link can read it. "+ Save to contacts" keeps up to 50 addresses in this browser.
- A claim link or code shows in the "Sent privately" screen right after you send, with Copy link (the easiest way to send it), Copy code, Download and Share; that screen stays open until it is copied, downloaded or shared. The QR code holds the link too, so a phone camera opens it.
- Sent links, below the Send privately form, keeps every claim link you send (and a payment to a Gloam address whose private heads-up did not post). It lives only in that browser, encrypted like the private balance, so the passkey lock covers it; the backup does not include it. Each row shows the amount, the date, Locked if it has a phrase, and a status: Not used yet (the money has not moved; a claim that is still being secured has not moved it yet), Used (the money moved), Taken back, or Couldn't check (press Refresh). Every row has Copy code. A claim link that is Not used yet has Take back, which claims it into your own private balance like Receive does (a locked one asks for its phrase; the phrase is never saved). Take back is then secured like any claim, so once that move lands the link stops working; until it lands, whoever has the link could still claim it first. A payment to a Gloam address cannot be taken back. Remove clears a Used or Taken back row from the list. Nothing comes back on its own: an unused link stays claimable until someone moves the money, so Take back is how a sender gets it back. Payroll keeps its own links under Past runs.
- Receive: your Gloam address with its QR, Payments to you (checks on open, or Check now), Claim a payment (paste a code or claim link; claiming puts nothing on-chain), and Request a payment. "New address" makes a fresh Gloam address; payments to the old one still open in this browser.
- Your private balance belongs to the wallet that added or claimed it, on the selected network, in this browser. A balance that "disappeared" usually means a different wallet or network is selected: reconnect the same wallet and network. A Gloam address belongs to the browser it was made in.
- Settings: Account (with Appearance: light, dark, or match your device; the only theme switch in the app), Preferences (Fast send, Show USD), Network (Add to wallet), Recovery (Back up now, Turn off and delete backup, Restore from your backup), Passkey lock (Protect with a passkey, then Lock now and Remove passkey; the lock screen has Unlock and "Lost your passkey?", which starts over and only a backup brings the balance back), Backup (Copy backup, Download, Restore; holds balances only, not the Gloam address key, which Recovery does cover), Vault health, Proof files and Help.
- Payroll: CSV upload, runs of up to 200 people, Download results and Copy claim links after a run, Past runs (last 30 runs, in that browser), schedules with a "Payroll due" reminder.
- Tempo fees with a browser wallet are paid in PathUSD by default; the wallet menu has a Pay in OUSD option.
`;

const START_OPEN = `
GETTING STARTED (testing is open)
1. Open gloam.trade/app. On Tempo, tap Sign in to create an account or use your passkey (network fees are covered), or use a browser wallet. ${RH_CONNECT}
2. Claim test funds from Get test funds on Portfolio. On Tempo the button sends test stablecoins straight to your wallet. On Robinhood Chain it opens the Robinhood faucet (test ETH and sample stock tokens, once every 24 hours); test USDG comes from the Paxos faucet linked in the testnet guide.
3. Add privately: on Portfolio, pick an asset and a small amount, then confirm in your wallet.
4. Send a private payment from Vault > Pay > Send privately to a friend's Gloam address, or make a claim link. Keep Hide my wallet on.
5. Turn on Recovery in Settings so a cleared browser or a new device never loses your balance.
The full walkthrough is gloam.trade/docs/testnet, and testers share notes in the Testers topic.
`;

const START_CLOSED = `
USING THE APP NOW (the official tester program has not kicked off yet)
- The app is public on testnet and anyone can use it right now at gloam.trade/app. Help fully with every how-to question and every problem: getting test funds, adding privately, payments, codes, proofs, payroll, recovery, networks. Never refuse or hold back because "testing hasn't started". That is wrong.
- Only the official tester program (its tasks, rewards and guides) has not kicked off yet. Its directions land in the Testers topic. Say that only when someone asks about the program itself, tasks or how to join it.
- Quick start: open gloam.trade/app, get test funds from Get test funds on Portfolio, Add privately a small amount, then pay a friend's Gloam address from Vault > Pay > Send privately. The full walkthrough is gloam.trade/docs/testnet.
- Anyone who wants to join the tester program can apply at gloam.trade/testers.
`;

const REWARDS = `
TESTER REWARDS
- Rewards go to the first 30 testers only, based on the snapshot the team took when the paid spots closed. Everyone who applied after the snapshot is testing voluntarily, and the team values volunteers just as much.
- This was announced in a reply under Gloam's main post on X (@gloamtrade) and in the banner on the registration page, gloam.trade/testers. Point people there if they ask.
- Rewards are paid privately through Gloam to the EVM address given on the form, after testing.
- "How do we know who is in the first 30?": it is the order applications came in on the form, up to the moment the paid spots closed (that moment is the snapshot). The team confirms the final list. Answer this directly, no need to hand it to anyone.
- You cannot see the snapshot, so never tell anyone whether they are in the 30. If someone wants their own spot checked, that needs the team's list, so that one goes to Boss Duke.
- Do not promise amounts or dates. Boss Duke and the admins share the details in Announcements.
- Be kind with volunteers who missed the paid spots: thank them, never make them feel late or left out.
- Tester rewards are paid privately through Gloam after testing. They are not a token or an airdrop.`;

const CODES = `
CODES, LINKS AND ADDRESSES (what people paste in the group)
- gloamr1.<long string> is a Gloam address. It is made to be shared, like an account number. It is never a claim link or a payment code, so never call it one. Paying it seals the payment to its owner.
- gloam2t.<long string> is a payment sealed to someone's Gloam address. Only that address's owner can open it, so it is safe to share.
- gloam1.<long string> is a plain payment code. It is bearer, like cash: anyone who has it can claim the money.
- gloam1e.<long string> is a payment code locked with a phrase. The code plus its phrase lets anyone claim it. Capitals, extra spaces and curly quotes in the phrase do not matter ("Gloam" and "gloam" both work), but the words must be the same.
- A claim link looks like gloam.trade/claim?net=...#claim=<code> (older ones: gloam.trade/app/vault?...#claim=<code>). It is bearer, the same as a plain code. Tapping it opens a page showing the amount (or that it is locked) with a Claim it button that opens the app. On Tempo you can claim with a passkey sign-in, no wallet needed. On Robinhood Chain you need a wallet app: ${WALLET_APP ? "in Safari or Chrome on a phone, tap Use a wallet app and approve in MetaMask, Trust, Coinbase Wallet or OKX, then come back and tap Claim (with the Gloam relay on, the default, claiming and securing need no signature and no network switch); opening the link inside the wallet app's browser also works" : "on a phone, open the link inside the wallet app's browser"}. After claiming, the app offers Send one back.
- A payment request link (gloam.trade/app/vault?tab=move&mode=pay#to=gloamr1...&amount=...) and the app's QR for an address or a request ("Scan to pay privately", "Scan to receive funds") only say where to pay. They are safe to share.
- On testnet, posting codes and links in the group to test payments is fine, it is play money. On mainnet, a plain code or claim link should go privately to the one person, or pay their Gloam address instead so the payment is sealed to them.
- "Wrong passphrase or corrupt payment" means the words of the phrase differ from the sender's (capitals and spacing are fine) or the code got cut off when it was copied. Re-copy the whole code or link and check the phrase with the sender.
- You cannot open links, codes or wallets. In chat you only see codes as labels like [plain payment code] or [Gloam address], never the code itself, so never ask anyone to paste one. A label means the person DID post the real code and everyone else in the group can see it; never tell them it is missing or did not come through. To troubleshoot, ask for the exact error text, a screenshot or a transaction link.
- Someone posting their Gloam address (often with "my gloam address") so others can pay them is not asking you anything. If you are tagged on it, at most say others can pay it from Vault > Pay > Send privately.

ROBINHOOD CHAIN: ADDING STOCK TOKENS
- Add privately on Robinhood Chain supports ETH, USDG and the sample stock tokens TSLA, AMZN, PLTR, NFLX and AMD.
- The commonest mix-up: BOTH the app's network selector (in the header) and the wallet must be on Robinhood Chain testnet (chain ID 46630). If the app is on Tempo while the wallet is on Robinhood Chain, or the other way round, the tokens will not show or the add fails. Check both first.
- Stock tokens and USDG are ERC-20s, so adding one usually takes two wallet confirmations: approve, then add. The approve is skipped once it is done.
- Keep some ETH in the wallet for gas.
- Stock tokens and test ETH come from the Robinhood faucet, once every 24 hours, to the same address you use in Gloam. Test USDG comes from the Paxos faucet linked in the testnet guide.
- On Tempo the vault takes test stablecoins: OUSD, PathUSD, AlphaUSD, BetaUSD and ThetaUSD. Stocks are Robinhood Chain only.
`;

const ISSUES = `
COMMON ISSUES (from the app)
- Tempo faucet says "You already hold ... in test funds": the app skips the faucet once a wallet holds about $50,000 in test stablecoins. That is plenty to test with.
- "Faucet is busy, try again": wait a moment and tap it again. New funds land a few seconds after the faucet answers; the refresh button on Portfolio reloads balances.
- Robinhood faucet: one claim every 24 hours, to the same address you use in Gloam.
- Adding the network to a wallet: Gloam does it. Settings > Network > Add to wallet adds the selected testnet to the wallet, and when the wallet is on another network the wallet button shows "Switch to <network>", which adds the network if it is missing and switches. The faucet page is not needed for this.
- Wrong network: the app's network selector and the wallet must both be on the same chain. Robinhood Chain testnet is chain ID 46630, Tempo testnet is 42431. Passkey accounts are on Tempo; Robinhood Chain needs ${WALLET_APP ? "a wallet (a browser wallet, or a wallet app through Use a wallet app)" : "a browser wallet"}.
- Robinhood Chain MAINNET is chain ID 4663 (one digit shorter than the testnet's 46630). The Gloam app is not on mainnet yet (only the $GLOAM token is). A wallet set to "Robinhood Chain" is often on mainnet, which is the wrong one for the app.
- The error "The current chain of the wallet (id: 4663) does not match the target chain for the transaction (id: 46630)", or "Current Chain ID: 4663, Expected Chain ID: 46630": the wallet is on Robinhood Chain mainnet and the app needs Robinhood Chain testnet. Fix: tap "Switch to Robinhood Chain" on the wallet button at the top of the app (or Settings > Network > Add to wallet), approve it in the wallet, then try again; if the wallet will not switch, add the testnet by hand with the details above. Any other pair of IDs means the same thing: the wallet is on the first chain, the app wants the second (42431 is Tempo testnet). This is a known fix: answer it straight away, never hand it to the team.
- "Leave a little ETH for gas": on Robinhood Chain, keep some ETH in the wallet when adding ETH privately.
- "The backup service failed. Try again." under Settings > Recovery: the backup could not be saved on Gloam's server. It is not the person's wallet or device. Try Back up now again a little later; if it keeps failing, it is on Gloam's side and the team will fix it. The private balance itself is safe on that device meanwhile.
- Passkeys do not work inside a wallet app's built-in browser (MetaMask, Trust, Coinbase Wallet, OKX and the like): the prompt never opens. There, use "With your wallet" for Recovery, or open gloam.trade in Safari or Chrome to use a passkey. The app now hides the passkey buttons in those browsers and says why.
- "The passkey prompt was closed. Nothing changed.": the passkey window was dismissed or timed out. Tap the button again and finish the Face ID, Touch ID or security key step. If it keeps happening instantly, they are probably in a wallet app's browser (see above).
- "The passkey prompt didn't open in this browser.": the browser refused passkeys outright, usually a wallet app's browser. Use With your wallet, or Safari or Chrome.
- "Paste their Gloam address (it starts with gloamr1)": the To field is empty or holds a 0x address. Private payments go to Gloam addresses only; to pay someone without one, pick Claim link under To.
- "That is more than this balance holds.": the amount is bigger than the one balance picked under Pay from. Pick a bigger balance or send less.
- "This payment is for a different vault or network.": switch the app's network to the one the payment was made on, then claim.
- "Could not open this ticket with your tag, it was encrypted for someone else.": that sealed payment was for a Gloam address this browser does not hold.
- "This payment is locked, enter the passphrase from the sender.": it is a locked code; ask the sender for the phrase.
- "Not enough in the vault yet" or "Not enough in the shared vault to cash out right now": the vault holds too little of that asset at the moment. Try a smaller amount or later.
- "Your private balance is out of sync." or "This balance is not linked to the vault yet.": tap Refresh and try again.
- "This money was already spent. Refresh your balance.": that payment was already moved. Refresh.
- "Your view of the vault is out of date. Refresh and try again.": someone used the vault in between. Refresh and retry.
- "Too many requests from this device" or "The relay is busy": wait a minute, or turn off Hide my wallet and send from your wallet.
- "The relay is out of gas" or "The relay is off": turn off Hide my wallet and send from your wallet.
- "This payment is already being sent. Wait a moment and refresh.": it was submitted twice; the first one is going through.
- "That address is the vault itself. Cash out to a wallet you control.": pick your own wallet address for the cash out.
- "The issuer has paused this stablecoin": on Tempo the stablecoin's issuer blocked that add or cash out. Try another stablecoin.
- "Unlock your private balance with your passkey first.": the passkey lock is on; tap Unlock.
- "That passkey doesn't open this vault": a different passkey was used than the one that locked it.
- "No private balances to export." or "Enter the passphrase for this locked backup.": a backup export with nothing in it, or a locked backup that needs its phrase to restore.
- Payroll: "That is a public wallet, paying it would show the amount" means a CSV row has a 0x address (use a Gloam address or leave it blank for a claim link); "Up to 200 people per run" means split the CSV; "Finish the run first" means a Payroll total can only be proven once every payment in the run is settled.
- Proof stuck or failed: reload, prove in one tab at a time, try a smaller amount, or use a desktop.
- Root or tree mismatch: someone else just used the vault. Wait a few seconds, refresh and try again.
- No private balance after Add privately: check the transaction succeeded on the explorer, hard refresh, and do not clear site data mid-flow.
- A payment does not show for the person paid: they open Vault > Pay > Receive, where Payments to you checks on open (or tap Check now), or paste the code or link under Claim a payment.
- "Your wallet signs differently each time" when turning on Recovery: that wallet cannot hold a recovery key, use a passkey instead.
- "This wallet can't use Gloam.": the app's address checks blocked that wallet. An admin has to look at it.
- RPC errors or rate limits: the public testnet nodes are shared. Wait a minute and retry.

REPORTING BUGS AND WHERE TO GO
- Bugs: post in the Feedback topic, or in Testers with the steps, a screenshot or the explorer link of the transaction. Or type /bug followed by what happened.
- Never post a seed phrase or private key. A transaction hash, explorer link or Gloam address is fine.
- Questions: the Help topic. Ideas: the Feedback topic. News: Announcements and X @gloamtrade. Anything private: hello@gloam.trade. Website and docs: gloam.trade and gloam.trade/docs.
`;

/** The knowledge block for the system prompt. */
export function knowledgeBlock(testingOpen: boolean): string {
  return [
    ABOUT.trim(),
    TOKEN.trim(),
    APP_MAP.trim(),
    (testingOpen ? START_OPEN : START_CLOSED).trim(),
    REWARDS.trim(),
    CODES.trim(),
    ISSUES.trim(),
    `OFFICIAL LINKS (the only ones you may share)\n${OFFICIAL_LINKS.map((l) => `- ${l}`).join("\n")}`,
  ].join("\n\n");
}
