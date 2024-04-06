import WebSocket from "ws";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  BalanceChangeStream,
  dataStreamFilters,
  RestClient,
  CreateStreamsRequest,
  DeleteStreamsRequest,
} from "@hellomoon/api";

const API_KEY = "732027ca-56f4-4243-828e-3c6f01a9edc7";
const RPC_WSS = "wss://kiki-stream.hellomoon.io";
const RPC_URL = `https://rpc.hellomoon.io/${API_KEY}`;

type TxnData = {
  blockId: number;
  blockTime: number;
  transactionId: string;
  transactionPosition: number;
  account: string;
  accountOwner?: string; // Optional field
  mint?: string; // Optional field
  decimals: number;
  preBalance: number;
  postBalance: number;
  amount: number;
};

// {
//     blockId: 258555913,
//     blockTime: 1712352270,
//     transactionId: '5XXefKwBuMC9dwDBRxrvBWkMFyM5SsmzHuKtV98bmsXDCVUQKKGaAKKVpA6YiN8kUpjxcNPEU24ihPANKFx58Wb8',
//     transactionPosition: 422,
//     account: '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
//     accountOwner: 'AEHdYwoHCGwXoRxRjY39oRGe1jUKYy6w85LWESHbFRW3',
//     mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
//     decimals: 9,
//     preBalance: 53013823,
//     postBalance: 58013823,
//     amount: 5000000
//   },

class InboundTransactionListener {
  socket;
  subId: string;
  onTransactions: (txns: TxnData[]) => void;
  constructor(subId: string, onTransaction: (txns: TxnData[]) => void) {
    this.subId = subId;
    this.connect();
    this.onTransactions = onTransaction;
  }

  connect(e = null) {
    this.socket = new WebSocket(RPC_WSS);
    this.socket.addEventListener("open", (e) => this.onOpen(e));
    this.socket.addEventListener("message", (e) => this.onMessage(e));
    this.socket.addEventListener("close", (e) => this.connect(e)); //Reconnect
  }

  onOpen(e) {
    console.log("Socket open");
    const msg = JSON.stringify({
      action: "subscribe",
      apiKey: API_KEY,
      subscriptionId: this.subId,
    });

    this.socket.send(msg);
  }

  onMessage(e) {
    if (e.data.indexOf("successfully subscribed") > -1) return; //Subscribed

    const d: TxnData[] = JSON.parse(e.data);
    this.onTransactions(d);
  }
}

class SubscriptionStreamManager {
  stream: BalanceChangeStream;
  restClient: RestClient;
  constructor(mintAddr: string) {
    this.stream = new BalanceChangeStream({
      target: {
        targetType: "WEBSOCKET",
      },
      filters: {
        mint: dataStreamFilters.text.equals(mintAddr),
        amount: dataStreamFilters.numeric.greaterThanEquals(0),
      },
    });
    this.restClient = new RestClient(API_KEY);
  }
  async init() {
    const subData = this.restClient.send(new CreateStreamsRequest(this.stream));
    return subData;
  }
  async closeStream(subId: string) {
    return this.restClient.send(new DeleteStreamsRequest(subId));
  }
}

function formatMintAmount(amount: number, decimals: number) {
  const multiplier = Math.pow(10, decimals);
  const formattedAmount = (amount / multiplier).toFixed(decimals);
  return formattedAmount;
}

async function getMintDecimals(mintAdddr: string) {
  console.log("fetching decimals");
  const connection = new Connection(RPC_URL);
  const tokenSupply = await connection.getTokenSupply(new PublicKey(mintAdddr));
  const decimals = tokenSupply.value.decimals;
  console.log({ decimals });
  return decimals;
}

async function main(mint: string) {
  const streamManager = new SubscriptionStreamManager(mint);
  const subData = await streamManager.init();
  if (!subData?.subscriptionId) {
    throw new Error("Subscription not created");
  }
  // to subscribe for all mints:
  // const allMintsSubId = "5a47d17c-6e2e-42f6-bea9-7e458e91adce"
  const subId = subData.subscriptionId;

  const mintDecimals = await getMintDecimals(mint);
  const handleTxn = ({ account, accountOwner, amount, ...rest }: TxnData) => {
    if (!accountOwner) return;
    if (PublicKey.isOnCurve(accountOwner)) {
      console.log("\n New BUY Txn:");
      console.log("TokenAccount:", account);
      console.log("AccOwner:", accountOwner);
      console.log("txn amount", formatMintAmount(amount, mintDecimals));
      // console.log(rest);
    }
  };
  new InboundTransactionListener(subId, (txs) => {
    txs.map(handleTxn);
  });

  async function cleanupStream() {
    console.log("Closing stream sub..");
    await streamManager.closeStream(subId);
    process.exit(0);
  }
  process.on("SIGTERM", cleanupStream);
  process.on("SIGINT", cleanupStream);
  process.on("SIGHUP", cleanupStream);
  process.on("end", cleanupStream);
}

// USDC
// const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// GRIM
const mint = "5yfDdiW65gVXzrwt88AiWfXuVnCk3PPmzG7SXLDhs6pS";
main(mint);
