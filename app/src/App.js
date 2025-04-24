import React, { useState, useEffect, useRef } from 'react';
import { Container, Row, Col, Modal, Button, Form } from 'react-bootstrap';
import Web3 from 'web3';
import Queue from 'yocto-queue';
import NodeGraph from './components/NodeGraph';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import useBlockCache from './blockCache';

import * as utils from "./utils.js";

function App() {
  const { getCacheBlock, setCacheBlocks, clearCache, setCacheStartBlock } = useBlockCache();
  const [cacheSize, setCacheSize] = useState(300);

  const [showNodeModal, setShowNodeModal] = useState(true);
  const [nodeEndpoints, setNodeEndpoints] = useState(['']);

  const [transactionHash, setTransactionHash] = useState('');
  const [txDetail, setTxDetail] = useState(null);
  const [selectedToken, setSelectedToken] = useState('');
  const [tokenDetail, setTokenDetail] = useState(null);
  const [latestBlock, setLatestBlock] = useState('');

  const [nodeGraphData, setNodeGraphData] = useState([]);
  const [listData, setListData] = useState([]);
  const [displayMode, setDisplayMode] = useState('graph');
  const [showGraphList, setShowGraphList] = useState(false);

  const [error, setError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSuccessful, setIsSuccessful] = useState(false);
  const [showLiveTrackingModal, setShowLiveTrackingModal] = useState(false);
  const [systemStatus, setSystemStatus] = useState('initial');
  const [hoveredCell, setHoveredCell] = useState(null);
  const [selectedLink, setSelectedLink] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);

  let nodeGraphDataRef = useRef(null);

  let BLOCKS_PER_QUERY = useRef(null);
  let intervalID = useRef(null);

  let nodes = useRef([]);
  let jobs = useRef(new Queue());
  let prioritzedJobs = useRef(new Queue());
  let blockCache = useRef(new Map());
  let cacheStartBlock = useRef(null);
  let results = useRef({});

  let startTime = useRef(null);

  useEffect(() => {
    nodeGraphDataRef.current = nodeGraphData
  }, [nodeGraphData]);

  useEffect(() => { 
    if (txDetail) {
      if (systemStatus == "processing") {
        confirmAction();
      }

      cacheStartBlock.current = Math.max(latestBlock - cacheSize + 1, txDetail.blockNumber);
      setCacheStartBlock(cacheStartBlock.current);
    }
  }, [latestBlock]);

  useEffect(() => { 
    if (latestBlock && txDetail) {
      cacheStartBlock.current = Math.max(latestBlock - cacheSize + 1, txDetail.blockNumber);
      setCacheStartBlock(cacheStartBlock.current);
    }
  }, [cacheSize]);

  // Validate WebSocket URL format
  const isValidWebSocketUrl = (url) => {
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'ws:' || urlObj.protocol === 'wss:';
    } catch {
      return false;
    }
  };

  // Validate node endpoint with timeout
  const validateNodeEndpoint = async (url) => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 5000); // 5 second timeout

      const web3Instance = new Web3(url);
      
      web3Instance.eth.net.isListening()
        .then(async () => {
          clearTimeout(timeout);
          // Get network ID to verify we're on the right network
          const networkId = await web3Instance.eth.net.getId();
          // Mainnet sepolia ID is 1
          if (Number(networkId) !== 11155111) {
            reject(new Error('Not connected to Ethereum sepolia'));
          } else {
            resolve(web3Instance);
          }
        })
        .catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
    });
  };

  const handleNodeSubmit = async () => {
    setIsConnecting(true);
    setError('');

    try {
      // First check if any endpoint is empty
      const emptyEndpoints = nodeEndpoints.filter(endpoint => !endpoint.trim());
      if (emptyEndpoints.length > 0) {
        throw new Error('Please fill in all endpoint fields');
      }

      // Check if first endpoint is WebSocket
      if (!isValidWebSocketUrl(nodeEndpoints[0])) 
        throw new Error('Invalid WebSocket URL format. URL must start with ws:// or wss://');

      // Validate connection for all endpoints
      const validationErrors = [];
      for (let i = 0; i < nodeEndpoints.length; i++) {
        try {
          await validateNodeEndpoint(nodeEndpoints[i]);

          if (i == 0) nodes.current = [utils.addNode(nodeEndpoints[i])]
          else nodes.current.push(utils.addNode(nodeEndpoints[i]))
        } catch (err) {
          if (err.message === 'Connection timeout') {
            validationErrors.push('Connection timeout');
          } else if (err.message === 'Not connected to Ethereum sepolia') {
            validationErrors.push('Not connected to Ethereum sepolia');
          } else {
            validationErrors.push('Connection failed');
          }
        }
      }

      // If there are any validation errors, throw them all
      if (validationErrors.length > 0) {
        // Remove duplicates from validation errors
        const uniqueErrors = [...new Set(validationErrors)];
        throw new Error(uniqueErrors.join('\n'));
      }

      setShowNodeModal(false);
    } catch (err) {
      let errorMessage = 'Failed to connect to node(s).\n';
      if (err.message.includes('Connection timeout')) {
        errorMessage += 'Connection timed out. Please check your URLs and try again.';
      } else if (err.message.includes('Not connected to Ethereum sepolia')) {
        errorMessage += 'Please connect to Ethereum sepolia.';
      } else if (err.message.includes('Invalid WebSocket URL format')) {
        errorMessage += 'Invalid WebSocket URL format. URLs must start with ws:// or wss://';
      } else if (err.message.includes('Please fill in all endpoint fields')) {
        errorMessage += 'Please fill in all endpoint fields';
      } else {
        errorMessage += 'Connection failed. Please check your URLs and try again.';
      }
      setError(errorMessage);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleTransactionSubmit = async () => {
    try {
      setIsSubmitted(true);

      const tx = await utils.getTransactionDetail(
        nodes.current[0].web3, 
        selectedToken == "ETH" ? "" : tokenDetail.address, 
        transactionHash
      );

      setTxDetail(tx);
      setError('');
      setIsSuccessful(true);
      setSystemStatus('awaiting_confirmation');
    } catch (err) {
      console.log(err);
      setError('Invalid transaction hash. Please try again.' + `\n${err}`);
      setNodeGraphData([]);
      setIsSubmitted(false);
      setIsSuccessful(false);
      setSystemStatus('initial');
    }
  };

  // Set cache is only true for jobs created from originating tx 
  //   where blocks have never been fetched before
  const createJobs = (fromAddress, startBlock, setCache = false) => {
    startBlock = Number(startBlock);

    // First discovery of the fromAddress
    if (!results.current[fromAddress]) {
      console.log("\nNew address: ", fromAddress);
      results.current[fromAddress] = { index: null, startBlock, transfers: [], netBalance: 0 };

      if (setCache) {
        // Cache-setting jobs, must do fetching
        for (let i = startBlock; i <= latestBlock; i += BLOCKS_PER_QUERY.current) {
          const endBlock = Math.min(i + BLOCKS_PER_QUERY.current - 1, latestBlock);
          jobs.current.enqueue({
            setCache: endBlock >= cacheStartBlock.current,
            fromAddress,
            startBlock: i,
            endBlock
          })
        }
      } else {
        // Jobs from startBlock to (cacheStartBlock - 1), out of cache
        for (let i = startBlock; i < cacheStartBlock.current; i += BLOCKS_PER_QUERY.current) {
          jobs.current.enqueue({
            setCache,
            fromAddress,
            startBlock: i,
            endBlock: Math.min(i + BLOCKS_PER_QUERY.current - 1, cacheStartBlock.current - 1)
          })
        }

        if (cacheSize > 0) {
          // Jobs from cacheStartBlock to latestBlock
          jobs.current.enqueue({
            setCache,
            fromAddress,
            startBlock: cacheStartBlock.current,
            endBlock: latestBlock
          })
        }
      }

      return;
    }

    const originalStartBlock = results.current[fromAddress].startBlock;

    // Search range already covered by previously created jobs
    if (startBlock >= originalStartBlock) return;

    /**
     * e.g. startBlock = 1000, originalStartBlock = 1400
     *   To be added:
     *   -> { fromAddress, startBlock: 1000, endBlock: 1299 }
     *   -> { fromAddress, startBlock: 1300, endBlock: 1399 }
     * 
     *   Already created before:
     *   -> { fromAddress, startBlock: 1400, endBlock: 1700 }
     *                .
     *                .
     *                .
     *   -> { fromAddress, startBlock: 1400, endBlock: latest }
     * 
     *   When will this happen?
     *   Assume search range for A (originating address) is block 100-500
     *   1. A sends to B at block 200, and C at block 400
     *     -> job queue state: 420-500 (A), 200-500 (B), 400-500 (C)
     *   2. B sends to C at block 300
     *     -> job queue state: 310-500 (B), 400-500 (C), 300-400 (C)
     */
    if (startBlock < cacheStartBlock.current) {
      if (cacheSize > 0) {
        // Jobs from startBlock to (cacheStartBlock - 1), out of cache
        for (let i = startBlock; i < cacheStartBlock.current; i += BLOCKS_PER_QUERY.current) {
          jobs.current.enqueue({
            setCache,
            fromAddress,
            startBlock: i,
            endBlock: Math.min(i + BLOCKS_PER_QUERY.current - 1, cacheStartBlock.current - 1)
          })
        }

        // Jobs from cacheStartBlock to originalStartBlock
        jobs.current.enqueue({
          setCache,
          fromAddress,
          startBlock: cacheStartBlock.current,
          endBlock: originalStartBlock - 1
        })
      } else {
        for (let i = startBlock; i < originalStartBlock; i += BLOCKS_PER_QUERY) {
          jobs.current.enqueue({
            setCache,
            fromAddress,
            startBlock: i,
            endBlock: Math.min(i + BLOCKS_PER_QUERY.current - 1, originalStartBlock - 1)
          })
        }
      }
    } else {
      // End block must also be in cache
      jobs.current.enqueue({
        setCache,
        fromAddress,
        startBlock: startBlock,
        endBlock: originalStartBlock - 1
      })
    }

    results.current[fromAddress].startBlock = startBlock;
  }

  const takeJob = async (nodeId) => {
    const node = nodes.current[nodeId];
    if (
      node.activeJob != null || 
      jobs.current.size == 0 && prioritzedJobs.current.size == 0
    ) return;

    if (node.cooldown > 0) {
      node.cooldown = Math.max(node.cooldown - 1000, 0);
      console.log(`Node ${nodeId} new cooldown: ${node.cooldown}`)
      return;
    }

    const job = prioritzedJobs.current.size > 0 ? 
      prioritzedJobs.current.dequeue() :
      jobs.current.dequeue();

    node.activeJob = job;
    console.log(`Node ${nodeId} took new job: ${JSON.stringify(job)}`);

    let newAddresses = [];
    let newTransfers = [];

      try {
        if (selectedToken == "ETH") {
          let blocks = [];
          let promises = [];
          if (job.setCache || job.startBlock < cacheStartBlock.current) {
            for (let i = job.startBlock; i <= job.endBlock; ++i) {
              const cacheBlock = getCacheBlock(i);
              promises.push(cacheBlock ? cacheBlock : node.web3.getBlock(i, true))
            }
            blocks = await Promise.all(promises);

            if (job.setCache) setCacheBlocks(job.startBlock, blocks);
          } else {
            for (let i = job.startBlock; i <= job.endBlock; ++i) {
              const cacheBlock = getCacheBlock(i);
              if (cacheBlock) blocks.push(cacheBlock);
              // Cache may not be ready if cache-setting job took longer than expected
              //   and the following job immediately uses cache
              else promises.push(node.web3.getBlock(i, true));
            }

            if (promises.length > 0) {
              if (promises.length > BLOCKS_PER_QUERY.current)
                throw new Error("Cache not ready");

              const res = await Promise.all(promises);
              blocks.push(...res);
            }
          }

          for (const block of blocks) {
            for (const tx of block.transactions) {
              if (Number(tx.value) > 0 && utils.compareStrings(tx.from, job.fromAddress))
                newTransfers.push(tx);
            }
          }

          console.log(`Node ${nodeId} completed job (${JSON.stringify(job)}) with result ${blocks.length > 100 ? "hidden" : blocks}`);

          newTransfers = newTransfers.map(tx => {
            createJobs(tx.to, tx.blockNumber);

            results.current[tx.from].netBalance -= Number(tx.value);
            results.current[tx.to].netBalance += Number(tx.value);

            if (!graphNodeExists(tx.to)) newAddresses.push(tx.to);
            return { 
              txHash: tx.hash,
              blockNumber: Number(tx.blockNumber), 
              from: tx.from,
              to: tx.to, 
              trimmedAmount: `${utils.trimDecimals(Web3.utils.fromWei(tx.value, tokenDetail.unit))} ${selectedToken}`,
              amount: Web3.utils.fromWei(tx.value, tokenDetail.unit)
            };
          });
        } else {
          const logs = await node.web3.getPastLogs({
            fromBlock: job.startBlock,
            toBlock: job.endBlock,
            address: tokenDetail.address,
            topics: [
              utils.TRANSFER_EVENT_SIG,
              utils.addressToTopic(job.fromAddress)
            ]
          });
          console.log(`Node ${nodeId} completed job (${JSON.stringify(job)}) with result ${logs}`);

          newTransfers = logs.map(log => {
            const decodedLog = utils.decodeTransferLog(node.web3, log);
            createJobs(decodedLog.to, log.blockNumber);

            results.current[decodedLog.from].netBalance -= Number(decodedLog.value);
            results.current[decodedLog.to].netBalance += Number(decodedLog.value);

            if (!graphNodeExists(decodedLog.to)) newAddresses.push(decodedLog.to);
            return { 
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
              from: decodedLog.from,
              to: decodedLog.to, 
              trimmedAmount: `${utils.trimDecimals(Web3.utils.fromWei(decodedLog.value, tokenDetail.unit))} ${selectedToken}`,
              amount: Web3.utils.fromWei(decodedLog.value, tokenDetail.unit)
            };
          });
        }
      } catch (err) {
        if (String(err).includes("request") || String(err).includes("limit")) {
          node.cooldown = 2000;
          console.log(`Node ${nodeId} COOLDOWN ACTIVATED`)
        } else { console.log(`Node ${nodeId} error: `, err) };

        if (job.setCache) prioritzedJobs.current.enqueue(job);
        else jobs.current.enqueue(job);
      }

    node.activeJob = null;
    if (newAddresses.length > 0) updateNodeGraphData(newAddresses, null, null);
    if (newTransfers.length > 0) {
      results.current[job.fromAddress].transfers.push(...newTransfers);
      updateNodeGraphData(null, job.fromAddress, newTransfers);
    }
  }

  const assignJobs = () => {
    let clearJob = jobs.current.size == 0 && prioritzedJobs.current.size == 0;

    for (let i = 0; i < nodes.current.length; ++i) {
      takeJob(i);
      if (nodes.current[i].activeJob != null) clearJob = false;
    }

    if (!clearJob) return;

    console.log(`\nUsed ${(Date.now() - startTime.current) / 1000} seconds`);
    clearInterval(intervalID.current);

    // Show live tracking modal after 2 seconds
    setTimeout(() => {
      setShowLiveTrackingModal(true);
    }, 2000);
  }

  const graphNodeExists = (targetAddress) => {
    for (const item of nodeGraphDataRef.current) {
      if (item.id == targetAddress) return true;
    }
    return false;
  }

  const updateNodeGraphData = (newAddresses, fromAddress = null, newTransfers = null) => {
    setNodeGraphData(nodeGraphData => {
      if (newAddresses && newAddresses.length > 0) {
        const updated = [
          ...nodeGraphData, 
          ...(newAddresses.map((address, index) => {
            results.current[address].index = nodeGraphData.length + index;
            return { id: address, connections: [] };
          }))
        ];
        return updated;
      }

      return [
        ...nodeGraphData.map((item, index) => {
          if (index != results.current[fromAddress].index) return item;

          return { 
            ...item, 
            connections: [
              ...item.connections, 
              ...newTransfers
            ] 
          }
        })
      ];
    });
  };

  const confirmAction = () => {
    results.current[txDetail.from] = { 
      index: null, 
      startBlock: latestBlock + 1, 
      transfers: [{ 
        txHash: transactionHash,
        blockNumber: txDetail.blockNumber,
        from: txDetail.from, 
        to: txDetail.to, 
        trimmedAmount: `${utils.trimDecimals(Web3.utils.fromWei(txDetail.amount, tokenDetail.unit))} ${selectedToken}`,
        amount: Web3.utils.fromWei(txDetail.amount, tokenDetail.unit)
      }],
      netBalance: 0
    };
        
    createJobs(txDetail.to, txDetail.blockNumber, true);
    results.current[txDetail.to].netBalance += txDetail.amount;

    // Add new nodes
    updateNodeGraphData([txDetail.from, txDetail.to]);
    // Add connections
    updateNodeGraphData(null, txDetail.from, results.current[txDetail.from].transfers)

    startTime.current = Date.now();
    intervalID.current = setInterval(assignJobs, 1100);
  }

  const handleConfirm = async () => {
    setSystemStatus("processing")
    setShowGraphList(true);

    const latestBlockMax = Number((await nodes.current[0].web3.getBlock("latest")).number);

    if (!latestBlock || latestBlock > latestBlockMax) {
      setLatestBlock(latestBlockMax);
    } else {
      confirmAction();
    }
  };

  async function startSubscription() {
    const node = nodes.current[0];

    if (selectedToken == "ETH") {
      // Subscribe to new block headers
      const subscription = await node.web3.subscribe('newBlockHeaders');
      
      subscription.on("data", async (blockHeader) => {
        if (!blockHeader.number) {
          console.log("Pending block");
          return;
        }

        // Get all transactions in the block
        const block = await node.web3.getBlock(blockHeader.number, true);

        if (!block || !block.transactions) {
          console.log(`No transactions found in block ${blockHeader.number}`);
          return;
        }

        for (const tx of block.transactions) {
          const entry = results.current[tx.from];
          if (entry && entry.netBalance > 0) {
            results.current[tx.from].netBalance -= Number(tx.value);
            if (results.current[tx.to]) {
              console.log(`To old address: ${tx.to}`);
              results.current[tx.to].netBalance += Number(tx.value);
            } else {
              console.log(`Discovered new address: ${tx.to}`);
              results.current[tx.to] = { index: null, startBlock: 0, transfers: [], netBalance: Number(tx.value) };
              updateNodeGraphData([tx.to], null, null);
            }

            const transfer = {
              txHash: tx.hash, 
              blockNumber: Number(blockHeader.number),
              from: tx.from,
              to: tx.to,
              trimmedAmount: `${utils.trimDecimals(Web3.utils.fromWei(tx.value, tokenDetail.unit))} ${selectedToken}`,
              amount: Web3.utils.fromWei(tx.value, tokenDetail.unit)
            };
            results.current[tx.from].transfers.push(transfer);
            updateNodeGraphData(null, tx.from, [transfer]);
            setListData(data => [...data, transfer]);

            await utils.checkAlert(tx.to, { 
              txHash: tx.hash, 
              from: tx.from, 
              to: tx.to, 
              blockNumber: Number(tx.blockNumber), 
              amount: `${Web3.utils.fromWei(tx.value, tokenDetail.unit)} ETH`
            });
          }
        }
      });

      return;
    }

    // Subscribe to ERC-20 transfer events
    const subscription = await node.web3.subscribe('logs', {
      address: tokenDetail.address, // Filter by the specific ERC-20 token contract address
      topics: [utils.TRANSFER_EVENT_SIG] // Filter by the Transfer event signature
    });
    
    subscription.on("data", async (log) => {
      // Decode the transfer event log
      const decodedLog = utils.decodeTransferLog(node.web3, log);
      const entry = results.current[decodedLog.from];
      if (entry && entry.netBalance > 0) {
        results.current[decodedLog.from].netBalance -= Number(decodedLog.value);

        if (results.current[decodedLog.to]) {
          console.log(`To old address: ${decodedLog.to}`);
          results.current[decodedLog.to].netBalance += Number(decodedLog.value);
        } else {
          console.log(`Discovered new address: ${decodedLog.to}`);
          results.current[decodedLog.to] = { index: null, startBlock: 0, transfers: [], netBalance: Number(decodedLog.value) };
          updateNodeGraphData([decodedLog.to], null, null);
        }

        const transfer = {
          txHash: log.transactionHash, 
          blockNumber: Number(log.blockNumber),
          from: decodedLog.from,
          to: decodedLog.to,
          trimmedAmount: `${utils.trimDecimals(Web3.utils.fromWei(decodedLog.value, tokenDetail.unit))} ${selectedToken}`,
          amount: Web3.utils.fromWei(decodedLog.value, tokenDetail.unit)
        };
        results.current[decodedLog.from].transfers.push(transfer);
        updateNodeGraphData(null, decodedLog.from, [transfer]);
        setListData(data => [...data, transfer]);

        await utils.checkAlert(decodedLog.to, { 
          txHash: log.transactionHash, 
          from: decodedLog.from, 
          to: decodedLog.to, 
          blockNumber: Number(log.blockNumber), 
          amount: `${Web3.utils.fromWei(decodedLog.value, tokenDetail.unit)} ${selectedToken}`
        });
      }
    });
  }

  const createListData = () => {
    let temp = [];
    for (const address in results.current) {
      temp = [...temp, ...results.current[address].transfers];
    }
    temp.sort((a, b) => {
      return a.blockNumber - b.blockNumber;
    });

    setListData(temp);
  };

  const handleLiveTrackingConfirm = () => {
    setShowLiveTrackingModal(false);
    createListData();
    setSystemStatus('live_tracking');
   
    startSubscription();
    console.log('Live tracking activated');
  };

  const handleLiveTrackingCancel = () => {
    setShowLiveTrackingModal(false);
    createListData();
    setSystemStatus('completed');
  };

  const handleReset = () => {
    setTransactionHash('');
    setTxDetail(null);
    setSelectedToken('');
    setTokenDetail(null);
    setLatestBlock('');
    setCacheSize(300);

    nodeGraphDataRef.current = null;
    intervalID.current = null;
    jobs.current.clear();
    prioritzedJobs.current.clear();
    blockCache.current.clear();
    cacheStartBlock.current = null;
    results.current = {};
    startTime.current = null;
    setNodeGraphData([]);
    setListData([]);
    setSelectedLink(null);
    setSelectedRow(null);
    
    setIsSubmitted(false);
    setIsSuccessful(false);
    setSystemStatus('initial');
    setShowGraphList(false);
  };

  const handleTerminate = () => {
    if (systemStatus == "processing") {
      clearInterval(intervalID.current);
      jobs.current = new Queue();
      console.log(`\nUsed ${(Date.now() - startTime.current) / 1000} seconds`);

      createListData();
    } else {
      nodes.current[0].web3.clearSubscriptions();
    }

    setSystemStatus("completed");
  };

  const handleAddEndpoint = () => {
    setNodeEndpoints([...nodeEndpoints, '']);
  };

  const handleEndpointChange = (index, value) => {
    const newEndpoints = [...nodeEndpoints];
    newEndpoints[index] = value;
    setNodeEndpoints(newEndpoints);
  };

  const handleRemoveEndpoint = (indexToRemove) => {
    setNodeEndpoints(nodeEndpoints.filter((_, index) => index !== indexToRemove));
  };

  const handleSaveNodeEndpoint = () => {
    handleNodeSubmit();
  };

  const handleLinkLabelClick = (link) => {
    const tx = results.current[link.fromAddress].transfers[link.index];
    setSelectedLink({ ...tx, from: link.fromAddress }); // Update the state with the clicked link's information
  };

  return (
    <Container fluid className="App">
      <Row className="header" style={{ display: showNodeModal ? 'none' : 'block' }}>
        <Col>
          <h1>Ethereum Blockchain Tracker</h1>
        </Col>
        <Col xs="auto" className="d-flex align-items-center justify-content-end">
          <Button 
            variant="primary" 
            onClick={() => setShowNodeModal(true)} 
            style={{ backgroundColor: '#87CEEB', borderColor: '#87CEEB' }}
            disabled={systemStatus == "processing" || systemStatus == "live_tracking"}
          >
            Add Nodes
          </Button>
        </Col>
      </Row>

      <div className="main-content" style={{ display: showNodeModal ? 'none' : 'block' }}>
        <Row>
          <Col md={6}>
            <div className="input-section">
              <Form>
                <Form.Group className="mb-3">
                  <Form.Label>Transaction Hash</Form.Label>
                  <Form.Control
                    type="text"
                    value={transactionHash}
                    disabled={systemStatus != "initial"}
                    onChange={(e) => {
                      setTransactionHash(e.target.value);
                    }}
                    placeholder="Enter transaction hash"
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>Select Token</Form.Label>
                  <Form.Select
                    value={selectedToken}
                    disabled={systemStatus != "initial"}
                    onChange={(e) => {
                      if (e.target.value == "ETH") {
                        setCacheSize(300);
                        BLOCKS_PER_QUERY.current = 13;
                      } else {
                        setCacheSize(0);
                        BLOCKS_PER_QUERY.current = 400;
                      }

                      setSelectedToken(e.target.value);
                      setTokenDetail(utils.getTokenDetail(e.target.value))
                    }}
                  >
                    <option value="">Select a token</option>
                    <option value="ETH">ETH</option>
                    <option value="USTT">USTT</option>
                  </Form.Select>
                </Form.Group>
                {error && <div className="error-message">{error}</div>}
                <div className="button-group">
                  {!isSuccessful ? (
                    <Button
                      variant="primary"
                      onClick={handleTransactionSubmit}
                      disabled={!transactionHash || !selectedToken}
                    >
                      Submit
                    </Button>
                  ) : (
                    <div style={{ display: "flex", "alignItems": "end" }}>
                      <div>
                        <Button
                          variant="success"
                          onClick={handleConfirm}
                          disabled={systemStatus != "awaiting_confirmation"}
                          className="me-2"
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="danger"
                          onClick={handleReset}
                          disabled={systemStatus != "awaiting_confirmation" && systemStatus != "completed" && systemStatus != "error"}
                          className="me-2"
                        >
                          Reset
                        </Button>
                      </div>

                      <div>
                        <label htmlFor="to-block" style={{ "fontSize": "13px" }}>Until block</label><br/>
                        <input 
                          type="text" 
                          disabled={systemStatus != "awaiting_confirmation"}
                          value={latestBlock} onChange={(e) => {
                            if (e.target.value) e.target.value = Number(e.target.value.replace(/[^0-9]/g, ''));
                            setLatestBlock(e.target.value);
                          }} 
                          className="me-2"
                        />
                      </div>

                      <div style={{ display: selectedToken != "ETH" ? 'none' : 'block' }}>
                        <label htmlFor="cache-size" style={{ "fontSize": "13px" }}>Cache size</label><br/>
                        <input 
                          type="text" 
                          name="cache-size"
                          disabled={systemStatus != "awaiting_confirmation"}
                          value={cacheSize} onChange={(e) => {
                            setCacheSize(Number(e.target.value.replace(/[^0-9]/g, '')));
                          }} 
                        />
                      </div>
                    </div>
                  )}
                </div>
              </Form>
            </div>
            <div className="system-status-box">
              <div className="status-content">
                <span className={`status-value ${systemStatus}`}>
                  {systemStatus === 'initial' && 'Please input transaction hash.'}
                  {systemStatus === 'awaiting_confirmation' && 'Awaiting confirmation...'}
                  {systemStatus === 'processing' && 'Fetching and processing transactions...'}
                  {systemStatus === 'live_tracking' && 'Live tracking in progress...'}
                  {systemStatus === 'completed' && 'Tracking completed!'}
                  {systemStatus === 'error' && 'Error Occurred'}
                </span>

                <Button
                  style={{ display: systemStatus == "processing" || systemStatus == "live_tracking" ? 'block' : 'none' }}
                  variant="danger"
                  onClick={handleTerminate}
                >
                  Terminate
                </Button>
              </div>
            </div>
          </Col>

          <Col md={6}>
            <div className="transaction-details-section">
              <h3>Transaction Details</h3>
              {isSubmitted ? (
                <div className="details-content">
                  {(() => {
                    if (txDetail) {
                      return (
                        <>
                          <div className="detail-item">
                            <strong>Sender:</strong> {txDetail.from}
                          </div>
                          <div className="detail-item">
                            <strong>Receiver:</strong> {txDetail.to}
                          </div>
                          <div className="detail-item">
                            <strong>Token Address:</strong> {tokenDetail.address}
                          </div>
                          <div className="detail-item">
                            <strong>Amount:</strong> {Web3.utils.fromWei(txDetail.amount, tokenDetail.unit)} {selectedToken}
                          </div>
                          <div className="detail-item">
                            <strong>Date & Time:</strong> {utils.formatTimestamp(txDetail.timestamp) + `    (${utils.daysAgo(txDetail.timestamp)})`}
                          </div>
                        </>
                      );
                    }
                    return (
                      <div className="no-details">
                        Transaction not found
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="no-details">
                  Enter a transaction hash and click Submit to view details
                </div>
              )}
            </div>
          </Col>
        </Row>

        <Row className="mt-4">
          <Col>
            {showGraphList && (
              <>
                <div className="dashboard-section">
                  <div className="display-toggle">
                    <Button
                      variant={`outline-${displayMode === 'graph' ? 'primary' : 'secondary'}`}
                      onClick={() => setDisplayMode('graph')}
                    >
                      Graph View
                    </Button>
                    <Button
                      variant={`outline-${displayMode === 'list' ? 'primary' : 'secondary'}`}
                      onClick={() => setDisplayMode('list')}
                    >
                      List View
                    </Button>
                  </div>
                  <div className="result-section">
                    <div className="graph-container" style={{display: displayMode === "graph" ? "block" : "none"}}>
                      <NodeGraph onLinkLabelClick={handleLinkLabelClick} data={{nodeGraphData, results, isLiveTracking: systemStatus == "live_tracking"}} />
                      {selectedLink && (
                        <div className="link-details">
                          <button className="close-button" onClick={() => setSelectedLink(null)}>✖</button>
                          <div style={{ marginLeft: "15px", marginTop: "15px" }}>
                            <h5>Transaction Detail</h5>
                            <p><b>Hash</b>: {selectedLink.txHash}</p>
                            <p><b>Block</b>: {selectedLink.blockNumber}</p>
                            <p><b>From</b>: {selectedLink.from}</p>
                            <p><b>To</b>: {selectedLink.to}</p>
                            <p><b>Amount</b>: {selectedLink.amount} {selectedToken}</p> 
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="list-container" style={{display: displayMode === "list" ? "block" : "none"}}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Sender</th>
                            <th>Receiver</th>
                            <th>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {systemStatus == "live_tracking" || systemStatus =="completed" ? (
                            listData.map((tx, index) => {
                              return (
                                <tr key={`${index}-${tx.to}-${tx.blockNumber}`}>
                                  <td
                                    className={hoveredCell === tx.from ? "highlight-out" : ""}
                                    onMouseEnter={() => setHoveredCell(tx.from)}
                                    onMouseLeave={() => setHoveredCell(null)}
                                  >{tx.from}</td>
                                  <td
                                    className={hoveredCell === tx.to ? "highlight-in" : ""}
                                    onMouseEnter={() => setHoveredCell(tx.to)}
                                    onMouseLeave={() => setHoveredCell(null)}
                                  >{tx.to}</td>
                                  <td
                                    onClick={() => setSelectedRow({
                                      txHash: tx.txHash,
                                      blockNumber: tx.blockNumber,
                                      from: tx.from,
                                      to: tx.to,
                                      amount: tx.amount
                                    })}
                                    style={{cursor: "pointer"}}
                                    className={selectedRow && selectedRow.txHash == tx.txHash ? "selected-row" : ""}
                                  >
                                    {tx.amount} {selectedToken}
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            nodeGraphData.flatMap(node => 
                              node.connections.map(conn => {
                                return (
                                  <tr key={`${node.id}-${conn.to}-${conn.blockNumber}`}>
                                    <td
                                      className={hoveredCell === node.id ? "highlight-out" : ""}
                                      onMouseEnter={() => setHoveredCell(node.id)}
                                      onMouseLeave={() => setHoveredCell(null)}
                                    >{node.id}</td>
                                    <td
                                      className={hoveredCell === conn.to ? "highlight-in" : ""}
                                      onMouseEnter={() => setHoveredCell(conn.to)}
                                      onMouseLeave={() => setHoveredCell(null)}
                                    >{conn.to}</td>
                                    <td
                                      onClick={() => setSelectedRow({
                                        txHash: conn.txHash,
                                        blockNumber: conn.blockNumber,
                                        from: conn.from,
                                        to: conn.to,
                                        amount: conn.amount
                                      })}
                                      style={{cursor: "pointer"}}
                                      className={selectedRow && selectedRow.txHash == conn.txHash ? "selected-row" : ""}
                                    >
                                      {conn.amount} {selectedToken}
                                    </td>
                                  </tr>
                                );
                              })
                            )
                          )}
                        </tbody>
                      </table>
                      {selectedRow && (
                        <div className="link-details">
                          <button className="close-button" onClick={() => setSelectedRow(null)}>✖</button>
                          <div style={{ marginLeft: "15px", marginTop: "15px" }}>
                            <h5>Transaction Detail</h5>
                            <p><b>Hash</b>: {selectedRow.txHash}</p>
                            <p><b>Block</b>: {selectedRow.blockNumber}</p>
                            <p><b>From</b>: {selectedRow.from}</p>
                            <p><b>To</b>: {selectedRow.to}</p>
                            <p><b>Amount</b>: {selectedRow.amount} {selectedToken}</p> 
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </Col>
        </Row>
      </div>

      {/* Node Endpoint Modal */}
      <Modal show={showNodeModal} onHide={() => setShowNodeModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Enter Node Endpoint</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error && (
            <div className="alert alert-danger mb-3" style={{ whiteSpace: 'pre-line' }}>
              {error}
            </div>
          )}
          <Form>
            {nodeEndpoints.map((endpoint, index) => (
              <Form.Group key={index} className="mb-3">
                <div className="d-flex align-items-center">
                  <div className="flex-grow-1">
                    <Form.Label>Node Endpoint {index + 1}</Form.Label>
                    <Form.Control
                      type="text"
                      value={endpoint}
                      onChange={(e) => handleEndpointChange(index, e.target.value)}
                      placeholder="Enter endpoint URL"
                      disabled={isConnecting || systemStatus == "processing"}
                    />
                  </div>
                  {nodeEndpoints.length > 1 && (
                    <Button
                      variant="outline-danger"
                      size="sm"
                      className="ms-2 mt-4"
                      onClick={() => handleRemoveEndpoint(index)}
                      disabled={systemStatus == "processing"}
                    >
                      ×
                    </Button>
                  )}
                </div>
                {index === nodeEndpoints.length - 1 && (
                  <Form.Text className="text-muted">
                    The first URL must be a WebSocket URL to facilitate live tracking
                  </Form.Text>
                )}
              </Form.Group>
            ))}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button 
            variant="secondary" 
            onClick={handleAddEndpoint}
          >
            Add
          </Button>
          <Button 
            variant="primary" 
            onClick={handleSaveNodeEndpoint}
            disabled={isConnecting || !nodeEndpoints[nodeEndpoints.length - 1]}
          >
            {isConnecting ? 'Connecting...' : 'Save'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Live Tracking Modal */}
      <Modal show={showLiveTrackingModal} onHide={handleLiveTrackingCancel}>
        <Modal.Header closeButton>
          <Modal.Title>Live Tracking Mode</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>Would you like to activate live tracking mode to monitor new transaction in real-time?</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleLiveTrackingCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleLiveTrackingConfirm}>
            Activate Live Tracking
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}

export default App; 