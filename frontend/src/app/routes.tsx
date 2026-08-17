import { createBrowserRouter } from "react-router";
import { RootLayout } from "./pages/RootLayout";
import { CoreEngine } from "./pages/CoreEngine";
import { ConsumerDashboard } from "./pages/ConsumerDashboard";
import { VectorDebugger } from "./pages/VectorDebugger";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: ConsumerDashboard },
      { path: "advanced", Component: CoreEngine },
      { path: "vector", Component: VectorDebugger },
    ],
  },
]);