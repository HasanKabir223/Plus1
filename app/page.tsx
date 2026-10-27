import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Ticker from "@/components/Ticker";
import Premise from "@/components/Premise";
import Network from "@/components/Network";
import Handoff from "@/components/Handoff";
import UseCases from "@/components/UseCases";
import Cta from "@/components/Cta";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <Ticker />
        <Premise />
        <Network />
        <Handoff />
        <UseCases />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
