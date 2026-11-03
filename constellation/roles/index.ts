import { budgetsFor } from "../allowances";
import { OWNER_31D2, OWNER_362B, OWNER_8E27 } from "../members";
import { swapRole } from "./swap";

// One role per owner, so each owner has budgets of their own
export const budgets = {
  "31d2": budgetsFor("31d2"),
  "362b": budgetsFor("362b"),
  "8e27": budgetsFor("8e27"),
};

export const swap_31d2 = swapRole(OWNER_31D2, budgets["31d2"]);
export const swap_362b = swapRole(OWNER_362B, budgets["362b"]);
export const swap_8e27 = swapRole(OWNER_8E27, budgets["8e27"]);
