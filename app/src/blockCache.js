import React from 'react';

export default function useBlockCache() {
    const cacheRef = React.useRef(new Map()); // Initialize the cache
    const cacheStartBlock = React.useRef(null);

    // Method to get a block from the cache
    const getCacheBlock = (blockNumber) => {
        return cacheRef.current.get(blockNumber) || null;
    };

    const blocksCached = () => {
        return cacheRef.current.size;
    };

    // Method to set a block in the cache
    const setCacheBlocks = (startBlock, blocks) => {
        if (startBlock + blocks.length - 1 >= cacheStartBlock.current) {
            const startIndex = startBlock < cacheStartBlock.current ? cacheStartBlock.current - startBlock : 0;
            for (let i = startIndex ; i < blocks.length; ++i) 
                cacheRef.current.set(startBlock + i, blocks[i]);
        }
    };

    // Method to clear the cache
    const clearCache = () => {
        cacheRef.current.clear();
        cacheStartBlock.current = null;
    };

    // Method to update the cache size dynamically
    const setCacheStartBlock = (newStartBlock) => {
        cacheStartBlock.current = newStartBlock;
    };

    return { getCacheBlock, blocksCached, setCacheBlocks, clearCache, setCacheStartBlock };
}