import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import ShellSideNav from "../page.tsx";

function App() {
  return (
    <Theme theme={neutralTheme}>
      <ShellSideNav />
    </Theme>
  );
}

export default App;
