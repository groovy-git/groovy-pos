import { ArrowLeft } from "lucide-react";
import { goBack } from "../lib/router";
import { BranchChip } from "./Branch";

export default function TopBar({ title, back, right, branch = true }) {
  return (
    <header className="topbar">
      {back ? (
        <button className="icon-btn" onClick={() => goBack(typeof back === "string" ? back : "home")} aria-label="Back">
          <ArrowLeft />
        </button>
      ) : (
        <img className="logo menu-logo" src="./logo.svg" alt="Groovy Fragrances" />
      )}
      <div className="title-wrap">
        <h1>{title}</h1>
        {branch && <BranchChip />}
      </div>
      {right}
    </header>
  );
}
