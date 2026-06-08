import { mount } from "svelte";
import App from "./App.svelte";
import { queryClient } from "@/lib/queryClient";
import "./app.css";

const target = document.getElementById("app");
if (!target) throw new Error("#app missing");

queryClient.mount();
mount(App, { target });
