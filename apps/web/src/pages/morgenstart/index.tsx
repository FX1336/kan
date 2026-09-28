import type { NextPageWithLayout } from "../_app";
import { getDashboardLayout } from "~/components/Dashboard";
import Popup from "~/components/Popup";
import MorgenstartView from "~/views/morgenstart";

const MorgenstartPage: NextPageWithLayout = () => {
  return (
    <>
      <MorgenstartView />
      <Popup />
    </>
  );
};

MorgenstartPage.getLayout = (page) => getDashboardLayout(page);

export default MorgenstartPage;
