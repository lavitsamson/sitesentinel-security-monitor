import {
  ArcElement,
  CategoryScale,
  Chart,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';

// Register only what the app's charts use, so the rest of Chart.js is tree-shaken.
Chart.register(ArcElement, CategoryScale, Filler, LineElement, LinearScale, PointElement, Tooltip);
