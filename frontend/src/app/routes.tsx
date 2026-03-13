import { createBrowserRouter } from "react-router";
import { RootLayout } from "./pages/RootLayout";
import { CoreEngine } from "./pages/CoreEngine";
import { IngestionEngine } from "./pages/IngestionEngine";
import { ReliabilityConsole } from "./pages/ReliabilityConsole";
import { VectorDebugger } from "./pages/VectorDebugger";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: CoreEngine },
      { path: "ingestion", Component: IngestionEngine },
      { path: "reliability", Component: ReliabilityConsole },
      { path: "vector", Component: VectorDebugger },
    ],
  },
]);