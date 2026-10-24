import { HomePagerScreen } from "@/features/home/home-pager-screen";
import { LOCAL_INFERENCE } from "@/config/local-inference";
import { LocalChatScreen } from "@/features/chat/local-chat-screen";

export default LOCAL_INFERENCE ? LocalChatScreen : HomePagerScreen;
