import "@testing-library/jest-dom/vitest";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { api } from "@/lib/api";

const offline = (config: InternalAxiosRequestConfig) =>
  Promise.reject(new AxiosError("Rede desativada nos testes", "ERR_NETWORK", config));
api.defaults.adapter = offline;
axios.defaults.adapter = offline;
