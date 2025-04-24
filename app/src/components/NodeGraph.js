import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

import { truncateAddress } from "../utils.js"

const NodeGraph = ({ data, onLinkLabelClick }) => {
  const svgRef = useRef();
  const nodeWidth = 120;
  const nodeHeight = 70;
  let isDragging = false;
  const positions = useRef({});
  const zoom = useRef(null);
  const freeForm = useRef(true);

  useEffect(() => {
    if (!data || data.nodeGraphData.length === 0) return;

    // Clear any existing SVG content
    d3.select(svgRef.current).selectAll("*").remove();

    const container = svgRef.current.parentElement;
    const width = container.offsetWidth;
    const height = container.offsetHeight;

    // Create the SVG container
    const svg = d3.select(svgRef.current)
      .attr('width', '100%')           // Allow the SVG to take full width
      .attr('height', '100%')          // Allow the SVG to take full height
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet'); // Maintain aspect ratio when resizing

    // Create a group for zoomable content
    const zoomableGroup = zoom ? 
      svg.append('g').attr("transform", zoom.current) :
      svg.append('g');

    // Define the zoom behavior
    const zoomHandler = d3.zoom()
      .scaleExtent([0.5, 2]) // Set zoom scale limits (e.g., 0.5x to 2x)
      .on('zoom', (event) => {
        zoom.current = event.transform;
        zoomableGroup.attr('transform', event.transform);
      });

    // Apply the zoom behavior to the SVG
    svg.call(zoomHandler);

    // Create nodes and links arrays for D3
    const nodes = [];
    for (let i = 0; i < data.nodeGraphData.length; ++i) {
      const node = data.nodeGraphData[i];
      if (i != data.results.current[node.id].index) continue;

      const position = positions.current[node.id];
      const colour = data.results.current[node.id].netBalance > 0 ? "#eb5959" : "#87CEEB";

      nodes.push({ 
        id: node.id, 
        name: truncateAddress(node.id, 4), 
        fx: position ? position.x : (data.isLiveTracking && !freeForm.current ? width / 2 : null), 
        fy: position ? position.y : (data.isLiveTracking && !freeForm.current ? height / 2 : null), 
        colour 
      });
    }

    let links = [];
    for (const node of data.nodeGraphData) {
      const temp = node.connections.map((conn, index) => ({
        searchIndex: index,
        source: node.id,
        target: conn.to,
        amount: conn.trimmedAmount
      }));

      links = [...links, ...temp];
    }

    // Create the force simulation
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(300))
      .force('charge', d3.forceManyBody().strength(-250))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(100));

    // Create the links
    const link = zoomableGroup.append('g') // Add to zoomable group
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', '#87CEEB')
      .attr('stroke-width', 2);

    // Add arrows to links
    svg.append('defs').selectAll('marker')
      .data(['arrow'])
      .enter()
      .append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 40)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#87CEEB');

    // Add amount labels to links
    const linkLabels = zoomableGroup.append('g') // Add to zoomable group
      .selectAll('text')
      .data(links)
      .enter()
      .append('text')
      .attr('fill', '#000')
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .attr('text-anchor', 'middle')
      // .attr('dy', 10)
      .text(d => d.amount)
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        if (onLinkLabelClick) {
          onLinkLabelClick({ index: d.searchIndex, fromAddress: d.source.id }); // Trigger the callback with the clicked link's information
        }
      });

    // Create the nodes
    const node = zoomableGroup.append('g') // Add to zoomable group
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .call(d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended));

    // Add rectangles to nodes instead of circles
    node.append('rect')
      .attr('width', nodeWidth)
      .attr('height', nodeHeight)
      .attr('rx', 8)
      .attr('ry', 8)
      .attr('fill', d => d.colour)
      .attr('stroke', '#fff')
      .attr('stroke-width', 2);

    // Add labels to nodes - block number smaller
    node.append('text')
      .attr('dy', nodeHeight / 2)
      .attr('dx', nodeWidth / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#fff')
      .attr('font-weight', 'bold')
      .attr('font-size', '12px')
      .text(d => d.name);

    // Update positions on each tick
    simulation.on('tick', () => {
      // Update link positions
      link
        .attr('x1', d => calculateEdgeIntersection(d.source, d.target, nodeWidth, nodeHeight).x)
        .attr('y1', d => calculateEdgeIntersection(d.source, d.target, nodeWidth, nodeHeight).y)
        .attr('x2', d => calculateEdgeIntersection(d.target, d.source, nodeWidth, nodeHeight).x)
        .attr('y2', d => calculateEdgeIntersection(d.target, d.source, nodeWidth, nodeHeight).y)
        .attr('marker-end', 'url(#arrow)');

      const labelPositions = [];
      linkLabels.each(function (d, i) {
        const label = d3.select(this);
        let x = (d.source.x + d.target.x) / 2;
        let y = (d.source.y + d.target.y) / 2;

        // Check for overlaps and adjust position
        labelPositions.forEach(pos => {
          const dx = x - pos.x;
          const dy = y - pos.y;
          const distance = Math.hypot(dx, dy);
          if (distance < 20) { // Minimum distance threshold
            y += 20; // Push the label down
          }
        });

        labelPositions.push({ x, y });
        label.attr('x', x).attr('y', y).text(d.amount);
      });

      node
        .attr('transform', d => `translate(${d.x - nodeWidth / 2},${d.y - nodeHeight / 2})`);
    });

    // Add hover interaction
    linkLabels
      .on('mouseover', function (event, d) {
        if  (isDragging) return;

        linkLabels
          .style('opacity', lbl => (lbl === d ? 1 : 0.2)); // Show only the hovered link's label

        // Highlight the source and target nodes
        node
          .style('opacity', n => (n.id === d.source.id || n.id === d.target.id ? 1 : 0.2));

        // Dim all other links
        link
          .style('opacity', lnk => (lnk === d ? 1 : 0.2));
      })
      .on('mouseout', function () {
        if  (isDragging) return;
        // Reset all styles
        linkLabels.style('opacity', 1);
        node.style('opacity', 1);
        link.style('opacity', 1);
      });

    // Add hover interaction for nodes
    node
      .on('mouseover', function (event, d) {
        if  (isDragging) return;

        const connectedLinks = links.filter(link => link.source.id === d.id || link.target.id === d.id);
        const connectedNodeIds = new Set(connectedLinks.flatMap(link => [link.source.id, link.target.id]));

        // Highlight the hovered node and connected nodes
        node
          .style('opacity', n => connectedNodeIds.has(n.id) ? 1 : 0.2);

        // Highlight the connected links
        link
          .style('opacity', l => l.source.id === d.id || l.target.id === d.id ? 1 : 0.2);

        // Highlight associated link labels
        linkLabels
          .style('opacity', lbl => lbl.source.id === d.id || lbl.target.id === d.id ? 1 : 0.2);
      })
      .on('mouseout', function () {
        if  (isDragging) return;
        // Reset all styles
        node.style('opacity', 1);
        link.style('opacity', 1);
        linkLabels.style('opacity', 1);
      });

    // Function to calculate the intersection point of a line with a rectangle's edge
    function calculateEdgeIntersection(source, target, rectWidth, rectHeight) {
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      // Determine the scaling factor based on the rectangle's dimensions
      const scale = Math.min(
        rectWidth / 2 / absDx || Infinity, // Avoid division by zero
        rectHeight / 2 / absDy || Infinity
      );

      // Calculate the intersection point
      const offsetX = dx * scale;
      const offsetY = dy * scale;

      return {
        x: source.x + offsetX,
        y: source.y + offsetY
      };
    }

    // Drag functions
    function dragstarted(event) {
      freeForm.current = false;
      const draggingId = event.subject.id;
      isDragging = true;
      if (!event.active) simulation.alphaTarget(0.3).restart();

      const connectedLinks = links.filter(link => {
        return link.source.id === draggingId || link.target.id === draggingId
      });
      const connectedNodeIds = new Set(connectedLinks.flatMap(link => [link.source.id, link.target.id]));

      // Highlight the hovered node and connected nodes
      node
        .style('opacity', n => connectedNodeIds.has(n.id) ? 1 : 0.2);

      // Highlight the connected links
      link
        .style('opacity', l => l.source.id === draggingId || l.target.id === draggingId ? 1 : 0.2);

      // Highlight associated link labels
      linkLabels
        .style('opacity', lbl => lbl.source.id === draggingId || lbl.target.id === draggingId ? 1 : 0.2);

      // Fix all other nodes
      nodes.forEach((node) => {
        if (node !== event.subject) {
          node.fx = node.x;
          node.fy = node.y;

          positions.current[node.id] = { x: node.x, y: node.y };
        }
      });

      // Allow the dragged node to move
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event) {
      // Update the position of the dragged node
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event) {
      isDragging = false;
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;

      positions.current[event.subject.id] = { x: event.subject.x, y: event.subject.y };
    }

  }, [data]);

  return (
    <div className="node-graph-container">
      <svg ref={svgRef}></svg>
    </div>
  );
};

export default NodeGraph; 