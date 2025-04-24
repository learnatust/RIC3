import Web3 from "web3";
import axios from "axios";

export const TRANSFER_EVENT_SIG = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function compareStrings(string1, string2) {
	return string1.toLowerCase() == string2.toLowerCase()
}

export function trimDecimals(val, dp = 6) {
	const parts = val.split(".");
	if (parts.length < 2) return val;

	return parts[0] + "." + parts[1].substring(0, dp - 1);
}

export function addressToTopic(address) {
	return ("0x" + address.substring(2).padStart(64, '0')).toLowerCase()
}

export function truncateAddress(address, length = 5) {
	return ("0x" + address.slice(2, 2 + length) + "..." + address.slice(-length))
}

export function formatTimestamp(timestamp) {
	const date = new Date(timestamp * 1000);
	return date.toLocaleString('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
}

export function daysAgo(timestamp) {
	const now = Date.now() / 1000;
	const diffSeconds = now - timestamp;
	let days = diffSeconds / 86400;

	days = Math.round(Math.abs(days));

	if (diffSeconds >= 0) {
		return days === 0 ? 'today' : `${days} day${days !== 1 ? 's' : ''} ago`;
	} else {
		return `in ${days} day${days !== 1 ? 's' : ''}`;
	}
}

export function decodeTransferLog(web3Eth, log) {
	return web3Eth.abi.decodeLog(
		[{
			type: 'address',
			name: 'from',
			indexed: true
		}, {
			type: 'address',
			name: 'to',
			indexed: true
		}, {
			type: 'uint256',
			name: 'value',
			indexed: false
		}],
		log.data,
		log.topics.slice(1) // Skip event signature
	);
}

export function addNode(url) {
	return {
		web3: new Web3(url).eth,
		activeJob: null,
		cooldown: 0
	};
}

export function getTokenDetail(symbol) {
	switch (symbol.toUpperCase()) {
		case "ETH":
			return {
				address: "N/A",
				unit: "ether" // 1e18
			}; 
		case "USTT":
			return {
				address: "0x349920b4d3Ca271Aa88988da0246c029a15671eA",
				unit: "ether" // 1e18
			}; 
		default:
			return null;
	}
}

export async function getTransactionDetail(web3Eth, tokenAddress, txHash) {
	if (tokenAddress == "") {
		const tx = await web3Eth.getTransaction(txHash);

		if (Number(tx.value) == 0) throw new Error('ETH transfer not found.');

		return {
			blockNumber: Number(tx.blockNumber),
			timestamp: Number((await web3Eth.getBlock(tx.blockNumber)).timestamp),
			from: tx.from,
			to: tx.to,
			amount: Number(tx.value)
		}
	}

	const receipt = await web3Eth.getTransactionReceipt(txHash);

	if (!receipt) {
		throw new Error('Transaction receipt not found.');
	}

	if (receipt.logs.length === 0) {
		throw new Error('No logs found in this transaction.');
	}

	const transferLog = receipt.logs.find(log =>
		compareStrings(log.topics[0], TRANSFER_EVENT_SIG) && // Check Transfer event
		compareStrings(log.address, tokenAddress) // Check token
	);

	if (!transferLog) {
		throw new Error('No ERC20 Transfer event found for the specified token in this transaction.');
	}

	const decodedLog = decodeTransferLog(web3Eth, transferLog);

	return {
		blockNumber: Number(receipt.blockNumber),
		timestamp: Number((await web3Eth.getBlock(receipt.blockNumber)).timestamp),
		from: decodedLog.from,
		to: decodedLog.to,
		amount: Number(decodedLog.value)
	}
}

export async function checkAlert(address, txDetail) {
	txDetail = JSON.stringify(txDetail);
	const res = await axios.post('http://localhost:4500/check-address', {
		address,
		txDetail
	})
	console.log("Alert mechanism: ", res.data.message);
}
