// @ts-expect-error
import TronWeb from "tronweb";

export interface TronTransactionData {
  raw_data: {
    contract: Array<{
      parameter: {
        value: {
          contract_address: string; // hex 41...
          owner_address: string; // hex 41...
          data: string; // selector + params (hex, không có "0x")
          call_value?: number;
        };
        type_url: string;
      };
      type?: "TriggerSmartContract";
    }>;
    ref_block_bytes: string;
    ref_block_hash: string;
    expiration: number;
    timestamp: number;
    fee_limit?: number;
  };
  signature: string[];
}

export interface TronBroadcastResult {
  result: boolean;
  txid?: string;
  message?: string;
  code?: string;
}

/**
 * Broadcast a signed Tron transaction
 * @param signedTransaction - Signed transaction object (có raw_data + signature) hoặc { transaction: {...} }
 * @param isTestnet - Nile (testnet) hay Mainnet
 */
export async function broadcastTronTransaction(
  signedTransaction: any,
  isTestnet: boolean
): Promise<TronBroadcastResult> {
  try {
    const tronWeb = new TronWeb({
      fullHost: isTestnet
        ? "https://nile.trongrid.io"
        : "https://api.trongrid.io",
    });

    if (!signedTransaction) {
      throw new Error("Missing transaction data");
    }

    // ❌ Không chấp nhận string signature — phải là object transaction đã ký
    if (typeof signedTransaction === "string") {
      throw new Error(
        "Expected signed transaction object, got string signature."
      );
    }

    // ❌ Không thể broadcast mảng chữ ký
    if (Array.isArray(signedTransaction)) {
      throw new Error(
        "Expected signed transaction object, got array of signatures."
      );
    }

    // Trường hợp ví trả về { transaction: {...} }
    const txObject =
      signedTransaction && signedTransaction.transaction
        ? signedTransaction.transaction
        : signedTransaction;

    // Phải có raw_data + signature
    if (
      !txObject?.raw_data ||
      !Array.isArray(txObject?.signature) ||
      txObject.signature.length === 0
    ) {
      throw new Error("Invalid transaction: missing raw_data or signature.");
    }

    const res = await tronWeb.trx.sendRawTransaction(txObject);

    console.log(res, " <- tronWeb.trx.sendRawTransaction response");

    // Các SDK/ ví có thể trả về nhiều format — normalize về TronBroadcastResult
    if (res?.result === true) {
      return { result: true, txid: res?.txid || res?.message };
    }
    if (res?.txid && !res?.code) {
      return { result: true, txid: res.txid };
    }
    if (res?.txid && res?.code) {
      return {
        result: false,
        txid: res.txid,
        message: `Transaction failed: ${res.code} - ${res.message}`,
        code: res.code,
      };
    }
    if (typeof res === "string" && res.length > 0) {
      return { result: true, txid: res };
    }

    return {
      result: false,
      message: `Transaction broadcast result unclear`,
      code: res?.code,
    };
  } catch (error) {
    return { result: false, message: (error as Error).message };
  }
}

/**
 * Reconstruct Tron transaction from signature and contract data
 * Dùng khi ví chỉ trả về chữ ký hoặc mảng chữ ký.
 */
export async function reconstructTronTransaction(
  signature: string,
  usdtContractAddress: string,
  customScAddress: string,
  amount: string,
  ownerAddress: string,
  isTestnet: boolean
): Promise<TronTransactionData> {
  const tronWeb = new TronWeb({
    fullHost: isTestnet
      ? "https://nile.trongrid.io"
      : "https://api.trongrid.io",
  });

  const built = await tronWeb.transactionBuilder.triggerSmartContract(
    usdtContractAddress,
    "approve(address,uint256)",
    { feeLimit: 200_000_000, callValue: 0 },
    [
      { type: "address", value: customScAddress },
      { type: "uint256", value: amount },
    ],
    ownerAddress
  );

  const unsignedTx = (built as any).transaction ?? built;

  const signed: TronTransactionData = {
    ...unsignedTx,
    signature: Array.isArray(unsignedTx.signature)
      ? [...unsignedTx.signature, signature]
      : [signature],
  };

  return signed;
}

/**
 * Extract transaction data from WalletConnect response
 * Ưu tiên trả về object transaction đầy đủ.
 */
export function extractTronTransactionData(response: any): any {
  if (!response) return null;

  // Phổ biến: { result: { transaction } | { raw_data, signature } | { txID } }
  if (response.result && typeof response.result === "object") {
    const r = response.result;
    if (r.transaction) return r.transaction;
    if (r.raw_data && r.signature) return r;
    if (r.txID) return { alreadyBroadcasted: true, txID: r.txID };
    if (r.raw_data || r.signature) return r;
  }

  // Trực tiếp trên root
  if (response.transaction) return response.transaction;
  if (response.raw_data && response.signature) return response;
  if (response.txID) return { alreadyBroadcasted: true, txID: response.txID };

  // Nếu chỉ có mảng chữ ký — caller sẽ phải reconstruct
  if (Array.isArray(response)) return response;
  if (typeof response === "string") return response; // chữ ký string — sẽ bị reject ở bước broadcast

  // Fallback: dò key có thể chứa dữ liệu tx
  if (typeof response === "object") {
    for (const k of Object.keys(response)) {
      const lower = k.toLowerCase();
      if (
        lower.includes("transaction") ||
        lower.includes("raw_data") ||
        lower.includes("signature") ||
        lower.includes("tx")
      ) {
        return (response as any)[k];
      }
    }
  }

  return response;
}

export function isTransactionAlreadyBroadcasted(transactionData: any): boolean {
  return !!(transactionData && transactionData.alreadyBroadcasted === true);
}

export function validateTronTransaction(transactionData: any): boolean {
  if (!transactionData) return false;

  // Đúng chuẩn transaction object
  if (
    transactionData.raw_data &&
    Array.isArray(transactionData.signature) &&
    transactionData.signature.length > 0
  ) {
    if (!Array.isArray(transactionData.raw_data.contract)) return false;
    return true;
  }

  // Mảng chữ ký (chưa đủ) — vẫn coi là hợp lệ để đi bước reconstruct
  if (Array.isArray(transactionData) && transactionData.length > 0) return true;

  // Đã broadcast rồi (chứa txID)
  if (transactionData.alreadyBroadcasted && transactionData.txID) return true;

  return false;
}

export function getTransactionHash(res: TronBroadcastResult): string | null {
  return res.result && res.txid ? res.txid : null;
}
